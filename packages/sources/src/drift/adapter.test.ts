import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { Decimal } from '@vaultbench/shared';

import { DriftSource } from './adapter.js';
import {
  encodeBase58,
  encodeVaultAccount,
  sharePrice,
  type VaultAccountFields,
} from './account.js';

function key(seed: string): Buffer {
  return createHash('sha256').update(seed).digest();
}

interface FixtureVault {
  name: string;
  seed: string;
  userShares: bigint;
  totalShares: bigint;
  equity: Decimal;
  withdrawRequested: bigint;
  managementFee: bigint;
  profitShare: number;
}

/**
 * Five vaults whose share price can be computed by hand from equity and
 * total shares — the Phase 2a gate. Equity is injected; inventing it from
 * the Vault account alone would be a guess.
 */
const FIXTURES: FixtureVault[] = [
  {
    name: 'Unit',
    seed: 'unit',
    userShares: 800_000n,
    totalShares: 1_000_000n,
    equity: new Decimal('1000000'),
    withdrawRequested: 0n,
    managementFee: 20_000n,
    profitShare: 100_000,
  },
  {
    name: 'Double',
    seed: 'double',
    userShares: 500_000n,
    totalShares: 1_000_000n,
    equity: new Decimal('2000000'),
    withdrawRequested: 1_000_000n,
    managementFee: 10_000n,
    profitShare: 200_000,
  },
  {
    name: 'Quarter',
    seed: 'quarter',
    userShares: 1_500_000n,
    totalShares: 2_000_000n,
    equity: new Decimal('500000'),
    withdrawRequested: 2_500_000n,
    managementFee: 0n,
    profitShare: 0,
  },
  {
    name: 'Exact',
    seed: 'exact',
    userShares: 250n,
    totalShares: 1_000n,
    equity: new Decimal('123456.789'),
    withdrawRequested: 5_000_000n,
    managementFee: 15_000n,
    profitShare: 50_000,
  },
  {
    name: 'Third',
    seed: 'third',
    userShares: 1n,
    totalShares: 3n,
    equity: new Decimal('10'),
    withdrawRequested: 0n,
    managementFee: 30_000n,
    profitShare: 250_000,
  },
];

function vaultFields(fixture: FixtureVault): VaultAccountFields {
  const pubkey = key(fixture.seed);
  return {
    name: fixture.name,
    pubkey,
    manager: key(`${fixture.seed}-mgr`),
    tokenAccount: key(`${fixture.seed}-tok`),
    userStats: key(`${fixture.seed}-stats`),
    user: key(`${fixture.seed}-user`),
    delegate: key(`${fixture.seed}-del`),
    liquidationDelegate: key(`${fixture.seed}-liq`),
    userShares: fixture.userShares,
    totalShares: fixture.totalShares,
    redeemPeriod: 14n * 86400n,
    totalWithdrawRequested: fixture.withdrawRequested,
    managementFee: fixture.managementFee,
    initTs: 1_700_000_000n,
    profitShare: fixture.profitShare,
    spotMarketIndex: 0,
    permissioned: false,
    vaultProtocol: false,
  };
}

function rpcEnvelope(fixtures: readonly FixtureVault[]): unknown {
  return {
    jsonrpc: '2.0',
    result: fixtures.map((fixture) => {
      const fields = vaultFields(fixture);
      return {
        pubkey: encodeBase58(fields.pubkey),
        account: {
          data: [encodeVaultAccount(fields).toString('base64'), 'base64'],
          owner: 'vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR',
        },
      };
    }),
  };
}

function equityByName(): Map<string, Decimal> {
  return new Map(FIXTURES.map((fixture) => [fixture.name, fixture.equity]));
}

describe('DriftSource', () => {
  it('lists five vaults from program accounts and records fee terms', async () => {
    const source = new DriftSource({
      fetchJson: () => Promise.resolve(rpcEnvelope(FIXTURES)),
    });
    const entities = await source.listEntities();
    expect(entities).toHaveLength(5);
    expect(entities.every((row) => row.provenance === 'api')).toBe(true);
    expect(entities.every((row) => row.positionsVisible === true)).toBe(true);
    expect(entities.every((row) => row.kind === 'vault')).toBe(true);

    const unit = entities.find((row) => row.name === 'Unit');
    expect(unit?.metadata.feeManagement?.toFixed()).toBe('0.02');
    expect(unit?.metadata.feeProfitShare?.toFixed()).toBe('0.1');
    expect(unit?.feeSchedule?.redemptionPeriodDays).toBe(14);
    expect(unit?.feeSchedule?.highWaterMark).toBe(true);
    expect(unit?.baseCurrency).toBe('USDC');
  });

  it('omits valuePerUnit when vault equity is not supplied', async () => {
    const source = new DriftSource({
      fetchJson: () => Promise.resolve(rpcEnvelope(FIXTURES)),
    });
    const snapshots = await source.snapshot(new Date('2026-09-04T00:00:00Z'));
    expect(snapshots).toHaveLength(5);
    expect(snapshots.every((row) => row.valuePerUnit === undefined)).toBe(true);
    expect(snapshots.every((row) => row.navQuality === 'raw')).toBe(true);
    expect(snapshots.every((row) => row.managerStakeRatio !== undefined)).toBe(true);
  });

  it('reconciles NAV-per-share against equity / totalShares for five vaults', async () => {
    const equity = equityByName();
    const source = new DriftSource({
      fetchJson: () => Promise.resolve(rpcEnvelope(FIXTURES)),
      vaultEquity: (vault) => equity.get(vault.name),
    });
    const snapshots = await source.snapshot(new Date('2026-09-04T00:00:00Z'));
    expect(snapshots).toHaveLength(5);

    for (const fixture of FIXTURES) {
      const snapshot = snapshots.find((row) => row.externalId === encodeBase58(key(fixture.seed)));
      const expected = sharePrice(fixture.equity, new Decimal(fixture.totalShares.toString()));
      expect(snapshot?.navQuality).toBe('reported');
      expect(snapshot?.valuePerUnit?.toFixed()).toBe(expected?.toFixed());
    }

    const unit = snapshots.find((row) => row.externalId === encodeBase58(key('unit')));
    expect(unit?.managerStakeRatio?.toFixed()).toBe('0.2');
    expect(unit?.pendingRedemptionsUsd?.toFixed()).toBe('0');

    const exact = snapshots.find((row) => row.externalId === encodeBase58(key('exact')));
    expect(exact?.pendingRedemptionsUsd?.toFixed()).toBe('5');
    expect(exact?.managerStakeRatio?.toFixed()).toBe('0.75');
  });

  it('archives program accounts and names each snapshot after its vault payload', async () => {
    const archived = new Set<string>();
    const source = new DriftSource({
      fetchJson: () => Promise.resolve(rpcEnvelope(FIXTURES)),
      onRaw: async (name) => {
        archived.add(name);
      },
    });
    const snapshots = await source.snapshot(new Date('2026-09-04T00:00:00Z'));
    expect(archived.has('programAccounts')).toBe(true);
    for (const snapshot of snapshots) {
      expect(snapshot.rawName).toBeDefined();
      expect(archived).toContain(snapshot.rawName);
    }
  });
});

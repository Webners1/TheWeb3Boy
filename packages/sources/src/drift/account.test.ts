import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { Decimal } from '@vaultbench/shared';

import {
  decodeVaultAccount,
  encodeVaultAccount,
  feeRateFromPercentagePrecision,
  managerStakeRatio,
  pendingRedemptionsUsd,
  redemptionPeriodDays,
  sharePrice,
  VAULT_ACCOUNT_SIZE,
  VAULT_DISCRIMINATOR,
  type VaultAccountFields,
} from './account.js';

function key(seed: string): Buffer {
  return createHash('sha256').update(seed).digest();
}

function fields(overrides: Partial<VaultAccountFields> = {}): VaultAccountFields {
  return {
    name: 'Test Vault',
    pubkey: key('vault'),
    manager: key('manager'),
    tokenAccount: key('token'),
    userStats: key('stats'),
    user: key('user'),
    delegate: key('delegate'),
    liquidationDelegate: key('liq'),
    userShares: 800n,
    totalShares: 1000n,
    redeemPeriod: 7n * 86400n,
    totalWithdrawRequested: 5_000_000n,
    managementFee: 20_000n,
    initTs: 1_700_000_000n,
    profitShare: 150_000,
    spotMarketIndex: 0,
    permissioned: false,
    vaultProtocol: false,
    ...overrides,
  };
}

describe('Drift vault account codec', () => {
  it('round-trips the published Vault layout', () => {
    const encoded = encodeVaultAccount(fields());
    expect(encoded.length).toBe(VAULT_ACCOUNT_SIZE);
    expect(encoded.subarray(0, 8).equals(VAULT_DISCRIMINATOR)).toBe(true);

    const decoded = decodeVaultAccount(encoded);
    expect(decoded.name).toBe('Test Vault');
    expect(decoded.userShares.toFixed()).toBe('800');
    expect(decoded.totalShares.toFixed()).toBe('1000');
    expect(decoded.totalWithdrawRequested.toFixed()).toBe('5000000');
    expect(decoded.managementFee.toFixed()).toBe('20000');
    expect(decoded.profitShare.toFixed()).toBe('150000');
    expect(decoded.spotMarketIndex).toBe(0);
    expect(decoded.permissioned).toBe(false);
    expect(decoded.vaultProtocol).toBe(false);
  });

  it('rejects a non-Vault discriminator', () => {
    const encoded = encodeVaultAccount(fields());
    encoded[0] = (encoded[0] ?? 0) ^ 0xff;
    expect(() => decodeVaultAccount(encoded)).toThrow(/discriminator/);
  });
});

describe('Drift share price and stake', () => {
  it('is vault equity over total shares, and undefined when shares are zero', () => {
    expect(sharePrice(new Decimal('1000000'), new Decimal('1000000'))?.toFixed()).toBe('1');
    expect(sharePrice(new Decimal('10'), new Decimal('3'))?.toFixed()).toBe(
      new Decimal('10').div('3').toFixed(),
    );
    expect(sharePrice(new Decimal('100'), new Decimal('0'))).toBeUndefined();
  });

  it('computes the non-user share as the manager stake ratio', () => {
    expect(managerStakeRatio(new Decimal('800'), new Decimal('1000'))?.toFixed()).toBe('0.2');
    expect(managerStakeRatio(new Decimal('0'), new Decimal('1000'))?.toFixed()).toBe('1');
    expect(managerStakeRatio(new Decimal('1000'), new Decimal('1000'))?.toFixed()).toBe('0');
    expect(managerStakeRatio(new Decimal('1'), new Decimal('0'))).toBeUndefined();
  });

  it('converts USDC withdraw requests and leaves other spot markets unset', () => {
    expect(pendingRedemptionsUsd(new Decimal('5000000'), 0)?.toFixed()).toBe('5');
    expect(pendingRedemptionsUsd(new Decimal('5000000'), 1)).toBeUndefined();
  });

  it('scales fee numerators by Drift PERCENTAGE_PRECISION (1e6)', () => {
    expect(feeRateFromPercentagePrecision(new Decimal('20000')).toFixed()).toBe('0.02');
    expect(feeRateFromPercentagePrecision(new Decimal('150000')).toFixed()).toBe('0.15');
    expect(redemptionPeriodDays(new Decimal(String(7 * 86400)))).toBe(7);
  });
});

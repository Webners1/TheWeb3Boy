import { dateFromEpochMillis, Decimal, fetchJson, TokenBucket } from '@vaultbench/shared';

import type { AdapterHooks, EntityDescriptor, RawSnapshot, Source } from '../types.js';
import { parseOrThrow } from '../parse.js';
import {
  decodeVaultAccount,
  DRIFT_VAULTS_PROGRAM_ID,
  feeRateFromPercentagePrecision,
  managerStakeRatio,
  pendingRedemptionsUsd,
  redemptionPeriodDays,
  sharePrice,
  USDC_SPOT_MARKET_INDEX,
  vaultDiscriminatorBase58,
  type DecodedVault,
} from './account.js';
import {
  accountDataBase64,
  programAccountsFromRpc,
  solanaRpcEnvelopeSchema,
} from './schemas.js';

const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

export interface DriftSourceOptions extends AdapterHooks {
  rpcUrl?: string;
  fetchJson?: typeof fetchJson;
  /**
   * Inject vault equity in deposit-asset human units (USDC dollars when
   * spot market 0). Live equity needs the Drift user account plus oracles;
   * that is not reimplemented here. Without this hook, `valuePerUnit` is
   * omitted rather than invented.
   */
  vaultEquity?: (vault: DecodedVault) => Decimal | undefined;
}

/**
 * Drift vault adapter.
 *
 * Ground truth is the on-chain program, not `data.api.drift.trade` (that
 * host does not resolve) and not Velocity's lookalike docs. Discovery is
 * `getProgramAccounts` filtered on the Vault discriminator. The Data API
 * OpenAPI client the plan suggested cannot be generated from a dead host.
 */
export class DriftSource implements Source {
  readonly id = 'drift';
  private readonly rpcUrl: string;
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];
  private readonly vaultEquity?: DriftSourceOptions['vaultEquity'];
  private readonly bucket = new TokenBucket(2, 2);
  private vaults: DecodedVault[] | null = null;

  constructor(options: DriftSourceOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.DRIFT_RPC_URL ?? DEFAULT_RPC_URL;
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
    this.vaultEquity = options.vaultEquity;
  }

  async listEntities(): Promise<EntityDescriptor[]> {
    const vaults = await this.loadVaults();
    return vaults.map((vault) => this.toDescriptor(vault));
  }

  async snapshot(date: Date): Promise<RawSnapshot[]> {
    const vaults = await this.loadVaults();
    return vaults.map((vault) => this.toSnapshot(vault, date));
  }

  /**
   * Drift's program account is the current state. There is no historical
   * share-price series without an indexer we do not run, so backfill yields
   * today's observation only.
   */
  async backfill(externalId: string): Promise<RawSnapshot[]> {
    const vaults = await this.loadVaults();
    const vault = vaults.find((row) => row.pubkey === externalId);
    if (vault === undefined) return [];
    return [this.toSnapshot(vault, new Date())];
  }

  private async loadVaults(): Promise<DecodedVault[]> {
    if (this.vaults) return this.vaults;

    const raw = await this.fetch(this.rpcUrl, {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [
          DRIFT_VAULTS_PROGRAM_ID,
          {
            encoding: 'base64',
            commitment: 'confirmed',
            filters: [{ memcmp: { offset: 0, bytes: vaultDiscriminatorBase58() } }],
          },
        ],
      },
      bucket: this.bucket,
      timeoutMs: 120_000,
    });
    await this.onRaw?.('programAccounts', raw);
    const envelope = parseOrThrow(solanaRpcEnvelopeSchema, raw, 'drift getProgramAccounts');
    const accounts = programAccountsFromRpc(envelope);

    const vaults: DecodedVault[] = [];
    for (const account of accounts) {
      await this.onRaw?.(`vault/${account.pubkey}`, account);
      const bytes = Buffer.from(accountDataBase64(account), 'base64');
      const vault = decodeVaultAccount(bytes);
      vaults.push(vault);
    }

    this.vaults = vaults;
    return vaults;
  }

  private toDescriptor(vault: DecodedVault): EntityDescriptor {
    const management = feeRateFromPercentagePrecision(vault.managementFee);
    const performance = feeRateFromPercentagePrecision(vault.profitShare);
    return {
      source: this.id,
      externalId: vault.pubkey,
      kind: 'vault',
      name: vault.name.length > 0 ? vault.name : vault.pubkey,
      venue: 'drift',
      venueType: 'dex',
      marketType: 'mixed',
      baseCurrency: vault.spotMarketIndex === USDC_SPOT_MARKET_INDEX ? 'USDC' : `spot:${vault.spotMarketIndex}`,
      inceptionDate: dateFromEpochMillis(Number(vault.initTs.mul(1000).toFixed(0))),
      status: 'active',
      provenance: 'api',
      positionsVisible: true,
      metadata: {
        feeManagement: management,
        feeProfitShare: performance,
      },
      feeSchedule: {
        managementFee: management,
        performanceFee: performance,
        redemptionPeriodDays: redemptionPeriodDays(vault.redeemPeriodSeconds),
        highWaterMark: true,
      },
    };
  }

  private toSnapshot(vault: DecodedVault, asOf: Date): RawSnapshot {
    const equity = this.vaultEquity?.(vault);
    const valuePerUnit =
      equity === undefined ? undefined : sharePrice(equity, vault.totalShares);
    const snapshot: RawSnapshot = {
      source: this.id,
      externalId: vault.pubkey,
      asOf,
      managerStakeRatio: managerStakeRatio(vault.userShares, vault.totalShares),
      pendingRedemptionsUsd: pendingRedemptionsUsd(
        vault.totalWithdrawRequested,
        vault.spotMarketIndex,
      ),
      sampling: 'daily',
      navQuality: valuePerUnit === undefined ? 'raw' : 'reported',
      rawName: `vault/${vault.pubkey}`,
    };
    if (valuePerUnit !== undefined) snapshot.valuePerUnit = valuePerUnit;
    if (equity !== undefined) {
      snapshot.accountValue = equity;
      snapshot.aumUsd = equity;
    }
    return snapshot;
  }
}

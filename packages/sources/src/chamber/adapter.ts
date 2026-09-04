import {
  Decimal,
  dateFromEpochMillis,
  fetchJson,
  parseDecimal,
  TokenBucket,
} from '@vaultbench/shared';

import type { AdapterHooks, EntityDescriptor, RawSnapshot, Source } from '../types.js';
import { parseOrThrow } from '../parse.js';
import {
  chamberAllFundsSchema,
  chamberTokenPriceHistorySchema,
  type ChamberFund,
} from './schemas.js';

const DEFAULT_ENDPOINT = 'https://api-v2.dhedge.org/graphql';

/**
 * Chains the Data API is wired for. Documented as case-insensitive, and an
 * unrecognised code may silently fall back to a default response instead of
 * erroring — so every chain's rows are checked against the code we asked for.
 */
export const CHAMBER_CHAINS = [
  'POLYGON',
  'OPTIMISM',
  'ARBITRUM',
  'BASE',
  'MAINNET',
  'HYPEREVM',
] as const;

/** Allowed `tokenPriceHistory` periods, per the API's own error message. */
export const CHAMBER_PERIODS = ['1d', '1w', '1m', '3m', '6m', '1y', 'all'] as const;
export type ChamberPeriod = (typeof CHAMBER_PERIODS)[number];

/** Wei scale: totalValue, totalSupply and Fund.tokenPrice carry 18 decimals. */
const WEI = new Decimal('1e18');

const ONE = new Decimal(1);

/** dHEDGE fee numerators are basis points over 10,000. */
const FEE_DENOMINATOR = new Decimal(10_000);

const FUND_FIELDS = `
  address name symbol managerName managerAddress managerLogicAddress
  blockchainCode poolType category isActive isPrivate
  totalValue totalSupply tokenPrice blockTime
  performanceFeeNumerator managerFeeNumerator streamingFeeNumerator
  entryFeeNumerator exitFeeNumerator
`;

export interface ChamberSourceOptions extends AdapterHooks {
  endpoint?: string;
  chains?: readonly string[];
  backfillPeriod?: ChamberPeriod;
  fetchJson?: typeof fetchJson;
}

/**
 * Chamber (formerly dHEDGE) tokenised vault adapter.
 *
 * No API key: the hosted Data API is public. That makes this the cheapest
 * survivorship-free source we have — the factory-derived vault list retains
 * dead vaults, so a vault that died two years ago is still queryable, which
 * is never true of a CEX leaderboard.
 *
 * The daily snapshot costs one request per chain and nothing per vault: the
 * fund list already carries `tokenPrice`, which is a genuine per-share NAV.
 * No TVL floor is applied at discovery on purpose — a floor would mark a
 * shrinking vault as delisted, inventing a death that never happened. Filter
 * for presentation, never for ingestion.
 */
export class ChamberSource implements Source {
  readonly id = 'chamber';
  private readonly endpoint: string;
  private readonly chains: readonly string[];
  private readonly backfillPeriod: ChamberPeriod;
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];
  private readonly bucket = new TokenBucket(5, 5);

  private funds: ChamberFund[] | null = null;

  constructor(options: ChamberSourceOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.CHAMBER_API_URL ?? DEFAULT_ENDPOINT;
    this.chains = options.chains ?? parseChains(process.env.CHAMBER_CHAINS) ?? CHAMBER_CHAINS;
    this.backfillPeriod = options.backfillPeriod ?? 'all';
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
  }

  async listEntities(): Promise<EntityDescriptor[]> {
    const funds = await this.loadFunds();
    return funds.map((fund) => toDescriptor(fund));
  }

  async snapshot(date: Date): Promise<RawSnapshot[]> {
    const funds = await this.loadFunds();
    const snapshots: RawSnapshot[] = [];

    for (const fund of funds) {
      // A vault with no shares issued has no meaningful per-share price.
      if (fund.tokenPrice === null || fund.tokenPrice === undefined) continue;
      const valuePerUnit = parseDecimal(fund.tokenPrice).div(WEI);
      if (valuePerUnit.lte(0)) continue;

      snapshots.push({
        source: this.id,
        externalId: externalId(fund),
        asOf: date,
        // A true per-share NAV, published by the venue. Already
        // time-weighted, so it needs no flow reconstruction.
        valuePerUnit,
        aumUsd: parseDecimal(fund.totalValue).div(WEI),
        sampling: 'daily',
        navQuality: 'reported',
      });
    }

    return snapshots;
  }

  /**
   * Historical per-unit value, reconstructed from cumulative return.
   *
   * `all` covers the vault's whole life at roughly two-day spacing (461
   * points for a 920-day vault, 872 for an older one), so this is
   * `downsampled` — coarser than a daily read but far finer than
   * Hyperliquid's ~93 points.
   *
   * The history's `adjustedTokenPrice` is cumulative return, not a price,
   * so the per-unit value is `1 + value`. See the schema note.
   */
  async backfill(externalIdValue: string): Promise<RawSnapshot[]> {
    const { address } = parseExternalId(externalIdValue);
    const payload = await this.graphql(
      `{tokenPriceHistory(address:${JSON.stringify(address)},period:${JSON.stringify(this.backfillPeriod)}){history{timestamp tokenPrice adjustedTokenPrice performance adjustedPerformance}}}`,
      `tokenPriceHistory/${externalIdValue}`,
    );

    const parsed = parseOrThrow(
      chamberTokenPriceHistorySchema,
      payload,
      `chamber tokenPriceHistory ${externalIdValue}`,
    );

    const history = parsed.data.tokenPriceHistory?.history ?? [];
    const snapshots: RawSnapshot[] = [];

    for (const point of history) {
      // `tokenPrice` is null on every point of a real response;
      // `adjustedTokenPrice` carries cumulative return since inception, so
      // the per-unit value is 1 + that. It is decimal-scaled, unlike
      // Fund.tokenPrice which is wei-scale.
      const raw = point.adjustedTokenPrice ?? point.performance;
      if (raw === null || raw === undefined) continue;
      const valuePerUnit = ONE.plus(parseDecimal(raw));
      // A return of -100% or worse leaves nothing to index from.
      if (valuePerUnit.lte(0)) continue;

      snapshots.push({
        source: this.id,
        externalId: externalIdValue,
        asOf: dateFromEpochMillis(point.timestamp),
        valuePerUnit,
        sampling: 'downsampled',
        navQuality: 'reported',
      });
    }

    return snapshots;
  }

  private async loadFunds(): Promise<ChamberFund[]> {
    if (this.funds) return this.funds;

    const all: ChamberFund[] = [];
    const seen = new Set<string>();

    for (const chain of this.chains) {
      const payload = await this.graphql(
        `{allFundsByBlockchainCode(blockchainCode:${JSON.stringify(chain)}){${FUND_FIELDS}}}`,
        `allFunds/${chain.toLowerCase()}`,
      );
      const parsed = parseOrThrow(
        chamberAllFundsSchema,
        payload,
        `chamber allFundsByBlockchainCode ${chain}`,
      );

      for (const fund of parsed.data.allFundsByBlockchainCode) {
        // An unrecognised chain code can fall back to another chain's data
        // rather than erroring. Trusting the response would silently
        // duplicate a chain's whole universe under the wrong code.
        if (fund.blockchainCode.toUpperCase() !== chain.toUpperCase()) continue;
        const key = externalId(fund);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(fund);
      }
    }

    this.funds = all;
    return all;
  }

  private async graphql(query: string, rawName: string): Promise<unknown> {
    const payload = await this.fetch(this.endpoint, {
      method: 'POST',
      body: { query },
      bucket: this.bucket,
      timeoutMs: 120_000,
    });
    await this.onRaw?.(rawName, payload);
    return payload;
  }
}

/**
 * `chain:address`. The same address can be deployed on more than one chain,
 * so the address alone is not a unique key across the Chamber universe.
 */
export function externalId(fund: ChamberFund): string {
  return `${fund.blockchainCode.toLowerCase()}:${fund.address}`;
}

export function parseExternalId(value: string): { chain: string; address: string } {
  const separator = value.indexOf(':');
  if (separator === -1) {
    throw new Error(`chamber external id must be "chain:address": ${value}`);
  }
  return {
    chain: value.slice(0, separator),
    address: value.slice(separator + 1),
  };
}

function toDescriptor(fund: ChamberFund): EntityDescriptor {
  const profitShare = fund.performanceFeeNumerator ?? fund.managerFeeNumerator;

  return {
    source: 'chamber',
    externalId: externalId(fund),
    kind: 'vault',
    name: fund.name,
    venue: `chamber:${fund.blockchainCode.toLowerCase()}`,
    venueType: 'dex',
    // Chamber vaults hold spot assets and can take derivative positions.
    marketType: 'mixed',
    baseCurrency: 'USD',
    ...(fund.blockTime === null || fund.blockTime === undefined
      ? {}
      : { inceptionDate: new Date(Number.parseInt(fund.blockTime, 10) * 1000) }),
    status: fund.isActive === false ? 'closed' : 'active',
    metadata: {
      ...(profitShare === null || profitShare === undefined
        ? {}
        : { feeProfitShare: parseDecimal(profitShare).div(FEE_DENOMINATOR) }),
      ...(fund.streamingFeeNumerator === null || fund.streamingFeeNumerator === undefined
        ? {}
        : { feeManagement: parseDecimal(fund.streamingFeeNumerator).div(FEE_DENOMINATOR) }),
    },
  };
}

function parseChains(raw: string | undefined): readonly string[] | undefined {
  if (!raw) return undefined;
  const chains = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
  return chains.length > 0 ? chains : undefined;
}

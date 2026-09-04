import type { Decimal } from 'decimal.js';

// Normalised, source-agnostic records returned by adapters.
// Adapters have ZERO database imports and never write anywhere (AGENTS.md);
// they fetch, validate with Zod, and return these plain objects.

export type EntityKind = 'vault' | 'lead_trader';
export type VenueType = 'cex' | 'dex';
export type MarketType = 'spot' | 'perp' | 'mixed';
export type EntityStatus = 'active' | 'closed' | 'delisted';
export type Sampling = 'daily' | 'downsampled';
/**
 * What a raw snapshot row holds, from the adapter's point of view:
 *
 * `raw`      — account value and/or cumulative PnL, no per-unit value. The
 *              per-unit series is derived later by `packages/compute`.
 * `reported` — the venue published a true per-unit NAV or share price.
 * `roi`      — the venue published only a money-weighted return. Kept
 *              separate from `reported` so it can be excluded from headline
 *              rankings; see NavQuality in @vaultbench/core.
 */
export type NavQuality = 'raw' | 'reported' | 'roi';

export interface EntityDescriptor {
  source: string;
  externalId: string;
  kind: EntityKind;
  name: string;
  venue: string;
  venueType: VenueType;
  marketType: MarketType;
  baseCurrency: string;
  inceptionDate?: Date;
  parentExternalId?: string;
  status: EntityStatus;
  metadata: {
    feeProfitShare?: Decimal;
    feeManagement?: Decimal;
    leaderCommission?: Decimal;
  };
}

export interface RawSnapshot {
  source: string;
  externalId: string;
  asOf: Date;
  valuePerUnit?: Decimal;
  accountValue?: Decimal;
  cumPnl?: Decimal;
  aumUsd?: Decimal;
  sampling: Sampling;
  navQuality: NavQuality;
}

export interface DepositorRecord {
  source: string;
  externalId: string;
  asOf: Date;
  depositor: string;
  equity?: Decimal;
  pnl?: Decimal;
  allTimePnl?: Decimal;
  daysFollowing?: number;
  entryTime?: Date;
  lockupUntil?: Date;
}

export interface Source {
  id: string;
  listEntities(): Promise<EntityDescriptor[]>;
  snapshot(date: Date): Promise<RawSnapshot[]>;
  backfill?(externalId: string): Promise<RawSnapshot[]>;
  listDepositors?(externalId: string): Promise<DepositorRecord[]>;
}

/** Benchmark prices (DefiLlama) are not entities — separate interface. */
export interface PriceSource {
  id: string;
  dailyClose(symbol: string, date: Date): Promise<Decimal>;
  history(
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ asOf: Date; closeUsd: Decimal }>>;
}

/**
 * Optional sink used by ingest to gzip-archive a payload *before* Zod parse.
 * Adapters never write to the database.
 */
export type RawSink = (name: string, payload: unknown) => Promise<void>;

export interface AdapterHooks {
  onRaw?: RawSink;
}

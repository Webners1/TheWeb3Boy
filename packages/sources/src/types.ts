import type { Decimal } from 'decimal.js';

// Normalised, source-agnostic records returned by adapters.
// Adapters have ZERO database imports and never write anywhere (AGENTS.md);
// they fetch, validate with Zod, and return these plain objects.

export type EntityKind = 'vault' | 'lead_trader';
export type VenueType = 'cex' | 'dex';
export type MarketType = 'spot' | 'perp' | 'mixed';
export type EntityStatus = 'active' | 'closed' | 'delisted';
export type Sampling = 'daily' | 'downsampled';
export type NavQuality = 'reported' | 'derived' | 'raw';

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

import { and, asc, eq, isNull, max } from 'drizzle-orm';
import {
  benchmarkPrices,
  depositors,
  entities,
  entityMetadataHistory,
  entitySnapshots,
  type Db,
} from '@vaultbench/db';
import { Decimal, parseDecimal } from '@vaultbench/shared';
import type { BenchmarkClose, DepositorPoint, SnapshotPoint } from '@vaultbench/core';

import { feeProfileFor } from './fees.js';
import type { FeeProfile } from '@vaultbench/core';

/** Symbols the benchmark spine covers. */
export const BENCHMARK_SYMBOLS = ['BTC', 'ETH', 'SOL'] as const;
export type BenchmarkSymbol = (typeof BENCHMARK_SYMBOLS)[number];

export interface EntityRow {
  id: string;
  source: string;
  externalId: string;
  name: string;
  kind: string;
  strategyCategory: string | null;
  status: string;
}

export async function loadEntities(db: Db, source?: string): Promise<EntityRow[]> {
  const query = db
    .select({
      id: entities.id,
      source: entities.source,
      externalId: entities.externalId,
      name: entities.name,
      kind: entities.kind,
      strategyCategory: entities.strategyCategory,
      status: entities.status,
    })
    .from(entities);

  // Delisted and closed entities are recomputed too. Dropping them would
  // reintroduce the survivorship bias the archive exists to prevent.
  const rows = source === undefined ? await query : await query.where(eq(entities.source, source));
  return rows;
}

/**
 * Raw snapshots in date order — the only input the NAV derivation gets.
 *
 * Numeric columns arrive as strings and are boxed into Decimal here, at the
 * single point where the raw table meets the maths.
 */
export async function loadSnapshots(db: Db, entityId: string): Promise<SnapshotPoint[]> {
  const rows = await db
    .select({
      asOf: entitySnapshots.asOf,
      valuePerUnit: entitySnapshots.valuePerUnit,
      accountValue: entitySnapshots.accountValue,
      cumPnl: entitySnapshots.cumPnl,
      sampling: entitySnapshots.sampling,
      navQuality: entitySnapshots.navQuality,
    })
    .from(entitySnapshots)
    .where(eq(entitySnapshots.entityId, entityId))
    .orderBy(asc(entitySnapshots.asOf));

  return rows.map((row) => ({
    asOf: row.asOf,
    valuePerUnit: optionalDecimal(row.valuePerUnit),
    accountValue: optionalDecimal(row.accountValue),
    cumPnl: optionalDecimal(row.cumPnl),
    sampling: row.sampling === 'daily' ? 'daily' : 'downsampled',
    // Carried through so a venue that publishes only money-weighted ROI
    // stays labelled `roi` and out of the headline rankings.
    ...(row.navQuality === 'roi' ? { navQuality: 'roi' as const } : {}),
  }));
}

/**
 * The most recent depositor cross-section for an entity.
 *
 * Deliberately the latest available date rather than a fixed one: the
 * cross-section decays as depositors exit, so the freshest capture is the
 * most complete one we will ever have.
 */
export async function loadLatestDepositors(
  db: Db,
  entityId: string,
): Promise<{ asOf: string; rows: DepositorPoint[] } | undefined> {
  const latest = await db
    .select({ asOf: max(depositors.asOf) })
    .from(depositors)
    .where(eq(depositors.entityId, entityId));

  const asOf = latest[0]?.asOf ?? null;
  if (asOf === null) return undefined;

  const rows = await db
    .select({
      depositor: depositors.depositor,
      equity: depositors.equity,
      allTimePnl: depositors.allTimePnl,
    })
    .from(depositors)
    .where(and(eq(depositors.entityId, entityId), eq(depositors.asOf, asOf)));

  return {
    asOf,
    rows: rows.map((row) => ({
      depositor: row.depositor,
      equity: optionalDecimal(row.equity),
      allTimePnl: optionalDecimal(row.allTimePnl),
    })),
  };
}

export type BenchmarkSeries = Partial<Record<BenchmarkSymbol, BenchmarkClose[]>>;

/** Loaded once per run: three symbols of daily closes is a few thousand rows. */
export async function loadBenchmarks(db: Db): Promise<BenchmarkSeries> {
  const rows = await db
    .select({
      symbol: benchmarkPrices.symbol,
      asOf: benchmarkPrices.asOf,
      closeUsd: benchmarkPrices.closeUsd,
    })
    .from(benchmarkPrices)
    .orderBy(asc(benchmarkPrices.asOf));

  const series: BenchmarkSeries = {};
  for (const row of rows) {
    if (!isBenchmarkSymbol(row.symbol)) continue;
    const bucket = series[row.symbol] ?? [];
    bucket.push({ asOf: row.asOf, closeUsd: new Decimal(row.closeUsd) });
    series[row.symbol] = bucket;
  }
  return series;
}

/**
 * Current fee terms from the open SCD-2 row, so a recompute uses the terms in
 * force rather than whatever the entity was created with.
 */
export async function loadFeeProfile(db: Db, entityId: string, source: string): Promise<FeeProfile> {
  const rows = await db
    .select({
      feeProfitShare: entityMetadataHistory.feeProfitShare,
      feeManagement: entityMetadataHistory.feeManagement,
      leaderCommission: entityMetadataHistory.leaderCommission,
    })
    .from(entityMetadataHistory)
    .where(
      and(eq(entityMetadataHistory.entityId, entityId), isNull(entityMetadataHistory.validTo)),
    )
    .limit(1);

  return feeProfileFor(source, rows[0]);
}

function isBenchmarkSymbol(value: string): value is BenchmarkSymbol {
  return (BENCHMARK_SYMBOLS as readonly string[]).includes(value);
}

function optionalDecimal(value: string | null): Decimal | undefined {
  return value === null ? undefined : parseDecimal(value);
}

import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, max, ne } from 'drizzle-orm';
import {
  benchmarkPrices,
  depositors,
  entities,
  entityFlows,
  entityMetrics,
  entityNav,
  entitySnapshots,
  metricDefinitions,
  type Db,
} from '@vaultbench/db';

/** Instruments that may share a ranking. Wallets are a different animal. */
export const RANKING_KINDS = ['vault', 'lead_trader'] as const;

/**
 * Every read the API performs, in one file.
 *
 * Read-only by construction and by check: `read-only-consumers` in
 * `tools/check-harness.mjs` fails the build if anything under `packages/api`
 * inserts, updates or deletes. A public read surface that can write is one
 * bug away from corrupting the archive.
 *
 * These functions return database rows unchanged — numeric columns stay
 * strings all the way to the JSON response, so no float ever exists.
 */

export interface EntityFilter {
  source?: string;
  kind?: string;
  status?: string;
  strategyCategory?: string;
  marketType?: string;
  headlineEligibleOnly?: boolean;
  fullWindowOnly?: boolean;
}

export type SortKey = 'twr' | 'alphaBtc' | 'maxDrawdown' | 'volatility' | 'followerGap' | 'name';

const SORT_COLUMNS = {
  twr: entityMetrics.twr,
  alphaBtc: entityMetrics.alphaBtc,
  maxDrawdown: entityMetrics.maxDrawdown,
  volatility: entityMetrics.volatility,
  followerGap: entityMetrics.followerGap,
  name: entities.name,
} as const;

function entityConditions(filter: EntityFilter) {
  const conditions = [];
  if (filter.source !== undefined) conditions.push(eq(entities.source, filter.source));
  if (filter.kind !== undefined) {
    conditions.push(eq(entities.kind, filter.kind));
  } else {
    // A wallet must never appear in a list that also includes vaults or
    // lead traders. Asking for kind=wallet is the only way to see them.
    conditions.push(inArray(entities.kind, [...RANKING_KINDS]));
  }
  if (filter.status !== undefined) conditions.push(eq(entities.status, filter.status));
  if (filter.marketType !== undefined) conditions.push(eq(entities.marketType, filter.marketType));
  if (filter.strategyCategory !== undefined) {
    conditions.push(eq(entities.strategyCategory, filter.strategyCategory));
  }
  return conditions;
}

export interface ListedEntity {
  entity: typeof entities.$inferSelect;
  metrics: typeof entityMetrics.$inferSelect | null;
}

/**
 * Entity list joined to the newest metrics row for the requested window.
 *
 * Closed and delisted entities are included unless the caller filters them
 * out. That is the default on purpose: a list that silently hides dead
 * entities is the survivorship bias this project exists to correct, and it
 * should take an explicit `status=active` to get it.
 */
export async function listEntities(
  db: Db,
  options: {
    windowDays: number;
    filter: EntityFilter;
    sort: SortKey;
    direction: 'asc' | 'desc';
    limit: number;
    offset: number;
  },
): Promise<{ rows: ListedEntity[]; total: number }> {
  const { windowDays, filter } = options;

  // The newest metrics date per entity for this window.
  //
  // The aggregate is aliased `newest_as_of`, not `as_of`: Drizzle emits the
  // subquery column unqualified, and `as_of` would then be ambiguous against
  // `entity_metrics.as_of` in the join condition.
  const newest = db
    .select({
      entityId: entityMetrics.entityId,
      asOf: max(entityMetrics.asOf).as('newest_as_of'),
    })
    .from(entityMetrics)
    .where(eq(entityMetrics.windowDays, windowDays))
    .groupBy(entityMetrics.entityId)
    .as('newest');

  const conditions = entityConditions(filter);
  if (filter.headlineEligibleOnly === true) {
    conditions.push(eq(entityMetrics.headlineEligible, true));
    // Defense in depth: even a stale row that still says eligible cannot
    // put a scrape on a headline board beside an API-derived vault.
    conditions.push(ne(entities.provenance, 'scraped'));
  }
  if (filter.fullWindowOnly === true) {
    conditions.push(eq(entityMetrics.isFullWindow, true));
  }
  // Sorting on a metric is meaningless for an entity that has none.
  if (options.sort !== 'name') {
    conditions.push(isNotNull(SORT_COLUMNS[options.sort]));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const order = options.direction === 'asc'
    ? asc(SORT_COLUMNS[options.sort])
    : desc(SORT_COLUMNS[options.sort]);

  const metricsJoin = and(
    eq(entityMetrics.entityId, entities.id),
    eq(entityMetrics.windowDays, windowDays),
    eq(entityMetrics.asOf, newest.asOf),
  );

  const page = db
    .select({ entity: entities, metrics: entityMetrics })
    .from(entities)
    .leftJoin(newest, eq(newest.entityId, entities.id))
    .leftJoin(entityMetrics, metricsJoin);

  const rows = await (where === undefined ? page : page.where(where))
    // Tie-broken by id so pagination is stable — without it two entities on
    // the same return can swap places between pages and one is never shown.
    .orderBy(order, asc(entities.id))
    .limit(options.limit)
    .offset(options.offset);

  const totals = db
    .select({ value: count() })
    .from(entities)
    .leftJoin(newest, eq(newest.entityId, entities.id))
    .leftJoin(entityMetrics, metricsJoin);

  const totalRows = await (where === undefined ? totals : totals.where(where));

  return { rows, total: Number(totalRows[0]?.value ?? 0) };
}

export async function latestSnapshotExtras(
  db: Db,
  entityIds: readonly string[],
): Promise<Map<string, { managerStakeRatio: string | null; pendingRedemptionsUsd: string | null }>> {
  const extras = new Map<
    string,
    { managerStakeRatio: string | null; pendingRedemptionsUsd: string | null }
  >();
  if (entityIds.length === 0) return extras;

  const newest = db
    .select({
      entityId: entitySnapshots.entityId,
      asOf: max(entitySnapshots.asOf).as('newest_snap_as_of'),
    })
    .from(entitySnapshots)
    .where(inArray(entitySnapshots.entityId, [...entityIds]))
    .groupBy(entitySnapshots.entityId)
    .as('newest_snap');

  const rows = await db
    .select({
      entityId: entitySnapshots.entityId,
      managerStakeRatio: entitySnapshots.managerStakeRatio,
      pendingRedemptionsUsd: entitySnapshots.pendingRedemptionsUsd,
    })
    .from(entitySnapshots)
    .innerJoin(
      newest,
      and(eq(entitySnapshots.entityId, newest.entityId), eq(entitySnapshots.asOf, newest.asOf)),
    );

  for (const row of rows) {
    extras.set(row.entityId, {
      managerStakeRatio: row.managerStakeRatio,
      pendingRedemptionsUsd: row.pendingRedemptionsUsd,
    });
  }
  return extras;
}

export async function findEntity(
  db: Db,
  id: string,
): Promise<typeof entities.$inferSelect | undefined> {
  const rows = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
  return rows[0];
}

/** Every window's newest metrics row for one entity. */
export async function metricsForEntity(
  db: Db,
  entityId: string,
): Promise<(typeof entityMetrics.$inferSelect)[]> {
  // One entity has at most a handful of windows times a handful of dates, so
  // the newest-per-window pick is done here rather than in a self-join. The
  // join version needed a subquery alias that Drizzle emits unqualified, and
  // a clear loop beats a query whose correctness depends on that detail.
  const rows = await db
    .select()
    .from(entityMetrics)
    .where(eq(entityMetrics.entityId, entityId))
    .orderBy(asc(entityMetrics.windowDays), desc(entityMetrics.asOf));

  const newestPerWindow = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (!newestPerWindow.has(row.windowDays)) newestPerWindow.set(row.windowDays, row);
  }
  return [...newestPerWindow.values()];
}

export async function metricsForWindow(
  db: Db,
  entityId: string,
  windowDays: number,
): Promise<typeof entityMetrics.$inferSelect | undefined> {
  const all = await metricsForEntity(db, entityId);
  return all.find((row) => row.windowDays === windowDays);
}

export async function navSeries(
  db: Db,
  entityId: string,
  range: { from?: string; to?: string },
): Promise<(typeof entityNav.$inferSelect)[]> {
  const conditions = [eq(entityNav.entityId, entityId)];
  if (range.from !== undefined) conditions.push(gte(entityNav.asOf, range.from));
  if (range.to !== undefined) conditions.push(lte(entityNav.asOf, range.to));

  return db
    .select()
    .from(entityNav)
    .where(and(...conditions))
    .orderBy(asc(entityNav.asOf));
}

export async function flowSeries(
  db: Db,
  entityId: string,
  range: { from?: string; to?: string },
): Promise<(typeof entityFlows.$inferSelect)[]> {
  const conditions = [eq(entityFlows.entityId, entityId)];
  if (range.from !== undefined) conditions.push(gte(entityFlows.asOf, range.from));
  if (range.to !== undefined) conditions.push(lte(entityFlows.asOf, range.to));

  return db
    .select()
    .from(entityFlows)
    .where(and(...conditions))
    .orderBy(asc(entityFlows.asOf));
}

export async function benchmarkCloses(
  db: Db,
  symbols: readonly string[],
  range: { from?: string; to?: string },
): Promise<(typeof benchmarkPrices.$inferSelect)[]> {
  if (symbols.length === 0) return [];
  const conditions = [inArray(benchmarkPrices.symbol, [...symbols])];
  if (range.from !== undefined) conditions.push(gte(benchmarkPrices.asOf, range.from));
  if (range.to !== undefined) conditions.push(lte(benchmarkPrices.asOf, range.to));

  return db
    .select()
    .from(benchmarkPrices)
    .where(and(...conditions))
    .orderBy(asc(benchmarkPrices.asOf));
}

/**
 * The freshest depositor cross-section. Deliberately the latest available
 * date rather than a requested one: the cross-section decays as depositors
 * exit, so the newest capture is the most complete that will ever exist.
 */
export async function latestFollowers(
  db: Db,
  entityId: string,
): Promise<{ asOf: string; rows: (typeof depositors.$inferSelect)[] } | undefined> {
  const latest = await db
    .select({ asOf: max(depositors.asOf) })
    .from(depositors)
    .where(eq(depositors.entityId, entityId));

  const asOf = latest[0]?.asOf ?? null;
  if (asOf === null) return undefined;

  const rows = await db
    .select()
    .from(depositors)
    .where(and(eq(depositors.entityId, entityId), eq(depositors.asOf, asOf)))
    .orderBy(desc(depositors.equity));

  return { asOf, rows };
}

export async function allMetricDefinitions(
  db: Db,
): Promise<(typeof metricDefinitions.$inferSelect)[]> {
  return db.select().from(metricDefinitions).orderBy(asc(metricDefinitions.key));
}

export async function availableWindows(db: Db): Promise<number[]> {
  const rows = await db
    .selectDistinct({ windowDays: entityMetrics.windowDays })
    .from(entityMetrics)
    .orderBy(asc(entityMetrics.windowDays));
  return rows.map((row) => row.windowDays);
}

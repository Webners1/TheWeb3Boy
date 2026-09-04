import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Every financial column is Postgres numeric, surfaced by Drizzle as a
// string. Parse it with decimal.js — a parseFloat on a money value is a
// defect (AGENTS.md). Trap references below point at docs/traps.md.
const money = (name: string, precision: number, scale: number) =>
  numeric(name, { precision, scale, mode: 'string' });

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // 'hyperliquid' | 'okx' | 'defillama'
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(), // 'vault' | 'lead_trader'
    name: text('name').notNull(),
    venue: text('venue').notNull(),
    venueType: text('venue_type').notNull(), // 'cex' | 'dex'
    marketType: text('market_type').notNull(), // 'spot' | 'perp' | 'mixed'
    strategyCategory: text('strategy_category'),
    baseCurrency: text('base_currency').notNull(),
    inceptionDate: date('inception_date', { mode: 'string' }),
    parentEntityId: uuid('parent_entity_id').references((): AnyPgColumn => entities.id),
    status: text('status').notNull(), // 'active' | 'closed' | 'delisted'
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('entities_source_external_id_key').on(t.source, t.externalId),
    index('entities_source_status_idx').on(t.source, t.status),
  ],
);

export const entitySnapshots = pgTable(
  'entity_snapshots',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    // Null unless a true per-unit NAV exists (trap 3).
    valuePerUnit: money('value_per_unit', 38, 18),
    // Flow-contaminated account value; never a return series (trap 3).
    accountValue: money('account_value', 28, 8),
    // Cumulative since inception; never difference it (trap 2).
    cumPnl: money('cum_pnl', 28, 8),
    aumUsd: money('aum_usd', 20, 2),
    // 'daily' | 'downsampled' — Hyperliquid allTime rows are downsampled (trap 1).
    sampling: text('sampling').notNull(),
    navQuality: text('nav_quality').notNull(), // 'reported' | 'derived' | 'raw'
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    rawRef: text('raw_ref'),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.asOf] }),
    index('entity_snapshots_as_of_idx').using('brin', t.asOf),
  ],
);

export const entityFlows = pgTable(
  'entity_flows',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    netFlowUsd: money('net_flow_usd', 28, 8),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.asOf] })],
);

export const depositors = pgTable(
  'depositors',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    depositor: text('depositor').notNull(),
    equity: money('equity', 28, 8),
    pnl: money('pnl', 28, 8),
    allTimePnl: money('all_time_pnl', 28, 8),
    daysFollowing: integer('days_following'),
    entryTime: timestamp('entry_time', { withTimezone: true }),
    lockupUntil: timestamp('lockup_until', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.asOf, t.depositor] }),
    index('depositors_entity_id_as_of_idx').on(t.entityId, t.asOf),
  ],
);

export const benchmarkPrices = pgTable(
  'benchmark_prices',
  {
    symbol: text('symbol').notNull(), // 'BTC' | 'ETH' | 'SOL'
    asOf: date('as_of', { mode: 'string' }).notNull(),
    closeUsd: money('close_usd', 20, 8).notNull(),
    source: text('source').notNull().default('defillama'),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.asOf] })],
);

export const entityMetadataHistory = pgTable(
  'entity_metadata_history',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }), // null = current
    name: text('name'),
    strategyCategory: text('strategy_category'),
    feeProfitShare: money('fee_profit_share', 6, 4),
    feeManagement: money('fee_management', 6, 4),
    leaderCommission: money('leader_commission', 6, 4),
    status: text('status'),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.validFrom] })],
);

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(), // 'running' | 'ok' | 'failed' | 'aborted'
  rowsWritten: integer('rows_written'),
  // Guard against silent failures: assert rows_written against yesterday's
  // count before committing a run (trap 4).
  rowsExpected: integer('rows_expected'),
  error: text('error'),
});

export const metricDefinitions = pgTable('metric_definitions', {
  key: text('key').primaryKey(),
  label: text('label'),
  description: text('description'),
  unit: text('unit'),
  direction: text('direction'),
  caveats: text('caveats'),
});

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntitySnapshot = typeof entitySnapshots.$inferSelect;
export type NewEntitySnapshot = typeof entitySnapshots.$inferInsert;
export type EntityFlow = typeof entityFlows.$inferSelect;
export type NewEntityFlow = typeof entityFlows.$inferInsert;
export type Depositor = typeof depositors.$inferSelect;
export type NewDepositor = typeof depositors.$inferInsert;
export type BenchmarkPrice = typeof benchmarkPrices.$inferSelect;
export type NewBenchmarkPrice = typeof benchmarkPrices.$inferInsert;
export type EntityMetadataRow = typeof entityMetadataHistory.$inferSelect;
export type NewEntityMetadataRow = typeof entityMetadataHistory.$inferInsert;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type MetricDefinition = typeof metricDefinitions.$inferSelect;
export type NewMetricDefinition = typeof metricDefinitions.$inferInsert;

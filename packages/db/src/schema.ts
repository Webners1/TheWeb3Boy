import {
  boolean,
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

// A return or ratio. Wider than the plan's numeric(12,6) on purpose: a vault
// that climbed from a dust NAV to a real one produces a return above 1e6, and
// numeric(12,6) would raise a Postgres overflow that aborts the whole
// recompute rather than flagging one bad row.
const rate = (name: string) => numeric(name, { precision: 20, scale: 10, mode: 'string' });

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // 'hyperliquid' | 'okx' | 'defillama'
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(), // 'vault' | 'lead_trader' | 'wallet'
    name: text('name').notNull(),
    venue: text('venue').notNull(),
    venueType: text('venue_type').notNull(), // 'cex' | 'dex'
    marketType: text('market_type').notNull(), // 'spot' | 'perp' | 'mixed'
    strategyCategory: text('strategy_category'),
    baseCurrency: text('base_currency').notNull(),
    inceptionDate: date('inception_date', { mode: 'string' }),
    parentEntityId: uuid('parent_entity_id').references((): AnyPgColumn => entities.id),
    status: text('status').notNull(), // 'active' | 'closed' | 'delisted'
    // How the row was obtained. Scraped entities are stored but never
    // headline-ranked beside API rows — enforced in compute and the API.
    provenance: text('provenance').notNull().default('api'), // 'api' | 'partner' | 'scraped'
    copyMode: text('copy_mode'), // 'classic' | 'pro' | 'tradfi' | 'spot' | 'futures' | 'bot'
    positionsVisible: boolean('positions_visible'),
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
    // Drift: (totalShares - userShares) / totalShares. Hyperliquid: leaderFraction.
    managerStakeRatio: money('manager_stake_ratio', 12, 8),
    // Drift: outstanding withdraw requests, USD when the deposit asset is USDC.
    pendingRedemptionsUsd: money('pending_redemptions_usd', 28, 8),
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

/**
 * Fee terms as observed, keyed so a later change is a new row rather than an
 * overwrite. Ingest owns this table; it is raw, not derived.
 */
export const feeSchedule = pgTable(
  'fee_schedule',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    managementFee: money('management_fee', 6, 4),
    performanceFee: money('performance_fee', 6, 4),
    redemptionPeriodDays: integer('redemption_period_days'),
    highWaterMark: boolean('high_water_mark'),
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

// ---------------------------------------------------------------------------
// Derived tables. Everything below this line is a pure function of the tables
// above and is safe to TRUNCATE and rebuild (AGENTS.md § Design principles:
// "Raw is append-only. Derived is disposable."). Nothing here is ever the only
// copy of a fact.
// ---------------------------------------------------------------------------

/**
 * Deposits and withdrawals, reconstructed from consecutive snapshots as
 * `Δaccount_value - Δcum_pnl`. Nobody publishes these directly, so they are a
 * derivation and belong on this side of the line.
 */
export const entityFlows = pgTable(
  'entity_flows',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    netFlowUsd: money('net_flow_usd', 28, 8),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.asOf] })],
);

/**
 * The per-unit value series — the atom every metric reads.
 *
 * It lives here rather than in `entity_snapshots.value_per_unit` because for
 * Hyperliquid and OKX it is *reconstructed* from account value net of flows,
 * not observed. Writing a derivation back into an append-only raw row would
 * mean a fix to the maths silently rewrites history; keeping it separate means
 * a fix is a TRUNCATE and a rerun.
 */
export const entityNav = pgTable(
  'entity_nav',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    valuePerUnit: money('value_per_unit', 38, 18).notNull(),
    navQuality: text('nav_quality').notNull(), // 'reported' | 'derived'
    method: text('method').notNull(), // 'reported' | 'simple' | 'dietz'
    sampling: text('sampling').notNull(), // 'daily' | 'downsampled' (trap 1)
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.asOf] }),
    index('entity_nav_as_of_idx').using('brin', t.asOf),
  ],
);

export const entityMetrics = pgTable(
  'entity_metrics',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    // 0 means "since inception" — see INCEPTION_WINDOW in @vaultbench/core.
    windowDays: integer('window_days').notNull(),
    twr: rate('twr'),
    benchTwrBtc: rate('bench_twr_btc'),
    benchTwrEth: rate('bench_twr_eth'),
    benchTwrSol: rate('bench_twr_sol'),
    alphaBtc: rate('alpha_btc'),
    alphaEth: rate('alpha_eth'),
    alphaSol: rate('alpha_sol'),
    // Gearing against each benchmark, and how much of the entity's variance
    // that benchmark explains. Stored next to alpha because alpha read on its
    // own invites calling leverage skill — trap 21.
    betaBtc: rate('beta_btc'),
    betaEth: rate('beta_eth'),
    betaSol: rate('beta_sol'),
    rSquaredBtc: rate('r_squared_btc'),
    rSquaredEth: rate('r_squared_eth'),
    rSquaredSol: rate('r_squared_sol'),
    maxDrawdown: rate('max_drawdown'),
    volatility: rate('volatility'),
    followerMedianReturn: rate('follower_median_return'),
    followerGap: rate('follower_gap'),
    // Never publish a number you cannot defend: these three travel with every
    // figure above and the UI is required to read them.
    daysCovered: integer('days_covered').notNull(),
    isFullWindow: boolean('is_full_window').notNull(),
    sampling: text('sampling').notNull(),
    navQuality: text('nav_quality'),
    // False for venues that publish money-weighted ROI only. Such rows are
    // excluded from headline rankings.
    headlineEligible: boolean('headline_eligible').notNull(),
    // Whether the twr above had a fee haircut applied. Stored rather than
    // inferred: "it must have been, the venue reports gross" is a guess, and
    // a guess about fees is exactly the kind of number we cannot defend.
    feesApplied: boolean('fees_applied').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.asOf, t.windowDays] }),
    index('entity_metrics_entity_id_window_days_idx').on(t.entityId, t.windowDays),
  ],
);

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
export type FeeScheduleRow = typeof feeSchedule.$inferSelect;
export type NewFeeScheduleRow = typeof feeSchedule.$inferInsert;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type EntityNavRow = typeof entityNav.$inferSelect;
export type NewEntityNavRow = typeof entityNav.$inferInsert;
export type EntityMetricsRow = typeof entityMetrics.$inferSelect;
export type NewEntityMetricsRow = typeof entityMetrics.$inferInsert;
export type MetricDefinition = typeof metricDefinitions.$inferSelect;
export type NewMetricDefinition = typeof metricDefinitions.$inferInsert;

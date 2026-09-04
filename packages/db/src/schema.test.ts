import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from './schema.js';

// Executable proof of AGENTS.md § Domain & Data Constraints:
//   "No floating point anywhere in the data path ... store as Postgres numeric."
// A future edit that swaps a numeric column for real/double precision, or adds
// a new money column as a float, fails here instead of silently corrupting
// every return series downstream.

const REQUIRED_TABLES = [
  'entities',
  'entity_snapshots',
  'entity_flows',
  'depositors',
  'benchmark_prices',
  'entity_metadata_history',
  'fee_schedule',
  'ingest_runs',
  'metric_definitions',
  'entity_nav',
  'entity_metrics',
] as const;

/** Derived tables: safe to TRUNCATE and rebuild from the raw tables. */
const DERIVED_TABLES = ['entity_flows', 'entity_nav', 'entity_metrics'] as const;

/** Postgres column types that cannot represent money exactly. */
const FLOAT_COLUMN_TYPES = ['PgReal', 'PgDoublePrecision'];

/** Every column that holds a monetary or rate value, by table. */
const MONEY_COLUMNS: Record<string, string[]> = {
  entity_snapshots: [
    'value_per_unit',
    'account_value',
    'cum_pnl',
    'aum_usd',
    'manager_stake_ratio',
    'pending_redemptions_usd',
  ],
  fee_schedule: ['management_fee', 'performance_fee'],
  entity_flows: ['net_flow_usd'],
  depositors: ['equity', 'pnl', 'all_time_pnl'],
  benchmark_prices: ['close_usd'],
  entity_metadata_history: ['fee_profit_share', 'fee_management', 'leader_commission'],
  entity_nav: ['value_per_unit'],
  entity_metrics: [
    'twr',
    'bench_twr_btc',
    'bench_twr_eth',
    'bench_twr_sol',
    'alpha_btc',
    'alpha_eth',
    'alpha_sol',
    'max_drawdown',
    'volatility',
    'follower_median_return',
    'follower_gap',
  ],
};

const tables = (Object.values(schema) as unknown[])
  // Drizzle tables carry the pg-table brand; type exports and helpers do not.
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));

const byName = new Map(tables.map((table) => [table.name, table]));

describe('schema shape', () => {
  it.each(REQUIRED_TABLES)('defines the %s table', (name) => {
    expect(byName.has(name)).toBe(true);
  });

  it('defines exactly the required tables and nothing else', () => {
    expect([...byName.keys()].sort()).toEqual([...REQUIRED_TABLES].sort());
  });
});

describe('derived tables are rebuildable', () => {
  it.each(DERIVED_TABLES)('keys %s so a recompute can upsert in place', (name) => {
    const table = byName.get(name);
    const primaryKey = table?.primaryKeys[0];
    expect(primaryKey?.columns[0]?.name).toBe('entity_id');
    expect(primaryKey?.columns.map((column) => column.name)).toContain('as_of');
  });

  it.each(DERIVED_TABLES)('stamps %s rows with the time they were computed', (name) => {
    const table = byName.get(name);
    const computedAt = table?.columns.find((column) => column.name === 'computed_at');
    expect(computedAt?.notNull).toBe(true);
  });

  it('makes every entity_metrics figure defensible', () => {
    // AGENTS.md § Design principles: never publish a number you cannot
    // defend. Coverage travels with the figures, so it cannot be null.
    const table = byName.get('entity_metrics');
    for (const name of ['days_covered', 'is_full_window', 'sampling', 'headline_eligible']) {
      const column = table?.columns.find((candidate) => candidate.name === name);
      expect(column?.notNull, `entity_metrics.${name} must be NOT NULL`).toBe(true);
    }
  });
});

describe('no floating point in the data path', () => {
  it('uses no real or double precision column anywhere', () => {
    const violations = tables.flatMap((table) =>
      table.columns
        .filter((column) => FLOAT_COLUMN_TYPES.includes(column.columnType))
        .map((column) => `${table.name}.${column.name} is ${column.columnType}`),
    );

    expect(violations).toEqual([]);
  });

  it.each(Object.entries(MONEY_COLUMNS))(
    'stores every money column on %s as numeric',
    (tableName, columnNames) => {
      const table = byName.get(tableName);
      expect(table, `missing table ${tableName}`).toBeDefined();

      for (const columnName of columnNames) {
        const column = table?.columns.find((candidate) => candidate.name === columnName);
        expect(column, `missing column ${tableName}.${columnName}`).toBeDefined();
        expect(column?.columnType, `${tableName}.${columnName}`).toBe('PgNumeric');
      }
    },
  );

  it('surfaces numeric columns to TypeScript as string, never number', () => {
    // mode:'string' keeps the value exact all the way to decimal.js. If a
    // column were left in the default mode Drizzle would hand back a JS
    // number and precision would be lost before any of our code ran.
    const violations = tables.flatMap((table) =>
      table.columns
        .filter((column) => column.columnType === 'PgNumeric' && column.dataType !== 'string')
        .map((column) => `${table.name}.${column.name} has dataType ${column.dataType}`),
    );

    expect(violations).toEqual([]);
  });
});

describe('append-only snapshot keys', () => {
  it('keys entity_snapshots by (entity_id, as_of)', () => {
    const table = byName.get('entity_snapshots');
    const primaryKey = table?.primaryKeys[0];
    expect(primaryKey?.columns.map((column) => column.name)).toEqual(['entity_id', 'as_of']);
  });

  it('keys depositors by (entity_id, as_of, depositor)', () => {
    const table = byName.get('depositors');
    const primaryKey = table?.primaryKeys[0];
    expect(primaryKey?.columns.map((column) => column.name)).toEqual([
      'entity_id',
      'as_of',
      'depositor',
    ]);
  });
});

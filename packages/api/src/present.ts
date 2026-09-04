import type { entities, entityFlows, entityMetrics, entityNav } from '@vaultbench/db';
import { Decimal } from '@vaultbench/shared';

import type { NavQuality, Sampling } from '@vaultbench/core';

type EntityRow = typeof entities.$inferSelect;
type MetricsRow = typeof entityMetrics.$inferSelect;
type NavRow = typeof entityNav.$inferSelect;
type FlowRow = typeof entityFlows.$inferSelect;

/**
 * Row-to-response mapping.
 *
 * Numeric columns arrive from Drizzle as strings and leave as strings. The
 * only transformation applied to a money value anywhere in this package is
 * `trimNumeric`, which drops the trailing zeros Postgres pads a fixed-scale
 * numeric with. It never parses to a float.
 */

/** `0.2500000000` reads badly and means the same as `0.25`. */
export function trimNumeric(value: string | null): string | null {
  if (value === null) return null;
  return new Decimal(value).toFixed();
}

function sampling(value: string): Sampling {
  return value === 'daily' ? 'daily' : 'downsampled';
}

function navQuality(value: string | null): NavQuality | null {
  if (value === 'reported' || value === 'derived' || value === 'roi') return value;
  return null;
}

export function presentEntity(row: EntityRow) {
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    kind: row.kind,
    name: row.name,
    venue: row.venue,
    venueType: row.venueType,
    marketType: row.marketType,
    strategyCategory: row.strategyCategory,
    baseCurrency: row.baseCurrency,
    inceptionDate: row.inceptionDate,
    status: row.status,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Coverage is built here and attached to every metrics payload, so there is
 * no code path that can emit a figure without it. See `coverageSchema`.
 */
export function presentCoverage(row: MetricsRow) {
  return {
    windowDays: row.windowDays,
    daysCovered: row.daysCovered,
    isFullWindow: row.isFullWindow,
    sampling: sampling(row.sampling),
    navQuality: navQuality(row.navQuality),
    headlineEligible: row.headlineEligible,
    feesApplied: row.feesApplied,
  };
}

export function presentMetrics(row: MetricsRow) {
  return {
    asOf: row.asOf,
    twr: trimNumeric(row.twr),
    benchTwrBtc: trimNumeric(row.benchTwrBtc),
    benchTwrEth: trimNumeric(row.benchTwrEth),
    benchTwrSol: trimNumeric(row.benchTwrSol),
    alphaBtc: trimNumeric(row.alphaBtc),
    alphaEth: trimNumeric(row.alphaEth),
    alphaSol: trimNumeric(row.alphaSol),
    maxDrawdown: trimNumeric(row.maxDrawdown),
    volatility: trimNumeric(row.volatility),
    followerMedianReturn: trimNumeric(row.followerMedianReturn),
    followerGap: trimNumeric(row.followerGap),
    coverage: presentCoverage(row),
  };
}

export function presentNavPoint(row: NavRow) {
  return {
    asOf: row.asOf,
    valuePerUnit: trimNumeric(row.valuePerUnit) ?? '0',
    navQuality: navQuality(row.navQuality) ?? 'derived',
    method: row.method === 'reported' || row.method === 'simple' ? row.method : 'dietz',
    sampling: sampling(row.sampling),
  } as const;
}

export function presentFlow(row: FlowRow) {
  return { asOf: row.asOf, netFlowUsd: trimNumeric(row.netFlowUsd) };
}

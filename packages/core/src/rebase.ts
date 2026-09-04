import { Decimal } from '@vaultbench/shared/decimal';

import { DEFAULT_SWAP_COST_BPS } from './benchmark.js';

const BPS = new Decimal(10_000);
const ONE = new Decimal(1);

/** The conventional chart base. Arbitrary, but it must be the same for all legs. */
export const INDEX_BASE = new Decimal(100);

export interface RebasePoint {
  asOf: string;
  /** Decimal string, as it comes out of a numeric column. */
  value: string;
}

export interface RebaseSeries {
  symbol: string;
  asOf: string;
  value: string;
}

export interface IndexPoint {
  asOf: string;
  value: string;
}

export interface RebaseResult {
  startAsOf: string | null;
  endAsOf: string | null;
  entity: IndexPoint[];
  benchmarks: Record<string, IndexPoint[]>;
}

export interface RebaseOptions {
  /** Entry cost charged to each benchmark leg, matching `benchmarkTwr`. */
  swapCostBps?: Decimal;
}

/**
 * Put an entity and its benchmarks on one comparable index.
 *
 * Two things make this honest, and both are easy to get wrong:
 *
 * 1. **One shared start date.** Every leg is rebased to 100 on the first date
 *    *all* of them have data for, not on each leg's own first date. Rebasing
 *    each series to its own start silently compares different periods, and
 *    for a vault launched into a drawdown that flatters it enormously.
 * 2. **The benchmark pays to get in.** The same entry swap cost that
 *    `benchmarkTwr` deducts is applied here, so the chart and the headline
 *    alpha figure cannot disagree.
 *
 * Pure, like everything in `core`: the API renders it and the tests check it
 * without either needing a database.
 */
export function rebaseSeries(
  input: {
    entity: readonly RebasePoint[];
    benchmarks: readonly RebaseSeries[];
  },
  options: RebaseOptions = {},
): RebaseResult {
  const bySymbol = new Map<string, RebasePoint[]>();
  for (const row of input.benchmarks) {
    const bucket = bySymbol.get(row.symbol) ?? [];
    bucket.push({ asOf: row.asOf, value: row.value });
    bySymbol.set(row.symbol, bucket);
  }
  for (const bucket of bySymbol.values()) {
    bucket.sort((left, right) => (left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0));
  }

  const entity = [...input.entity].sort((left, right) =>
    left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0,
  );

  // The latest of all the first dates: the earliest point at which every leg
  // has a value to index from.
  const firstDates = [entity[0]?.asOf, ...[...bySymbol.values()].map((bucket) => bucket[0]?.asOf)];
  const lastDates = [
    entity[entity.length - 1]?.asOf,
    ...[...bySymbol.values()].map((bucket) => bucket[bucket.length - 1]?.asOf),
  ];

  if (firstDates.some((date) => date === undefined) || entity.length === 0) {
    return { startAsOf: null, endAsOf: null, entity: [], benchmarks: {} };
  }

  const startAsOf = firstDates.filter((date): date is string => date !== undefined).sort().at(-1);
  const endAsOf = lastDates.filter((date): date is string => date !== undefined).sort().at(0);
  if (startAsOf === undefined || endAsOf === undefined || startAsOf > endAsOf) {
    return { startAsOf: null, endAsOf: null, entity: [], benchmarks: {} };
  }

  const swapCost = (options.swapCostBps ?? DEFAULT_SWAP_COST_BPS).div(BPS);
  const afterEntry = ONE.minus(swapCost);

  const entityIndex = indexFrom(entity, startAsOf, endAsOf, ONE);
  const benchmarks: Record<string, IndexPoint[]> = {};
  for (const [symbol, bucket] of bySymbol) {
    const indexed = indexFrom(bucket, startAsOf, endAsOf, afterEntry);
    if (indexed.length > 0) benchmarks[symbol] = indexed;
  }

  return { startAsOf, endAsOf, entity: entityIndex, benchmarks };
}

/**
 * `multiplier` is how much of the base survives entry — 1 for the entity,
 * `1 - swapCost` for a benchmark leg, so the benchmark starts marginally
 * below 100 exactly as a real allocator's position would.
 */
function indexFrom(
  points: readonly RebasePoint[],
  startAsOf: string,
  endAsOf: string,
  multiplier: Decimal,
): IndexPoint[] {
  const windowed = points.filter((point) => point.asOf >= startAsOf && point.asOf <= endAsOf);
  const base = windowed[0];
  if (base === undefined) return [];

  const baseValue = new Decimal(base.value);
  if (baseValue.lte(0)) return [];

  return windowed.map((point) => ({
    asOf: point.asOf,
    value: new Decimal(point.value)
      .div(baseValue)
      .times(multiplier)
      .times(INDEX_BASE)
      .toDecimalPlaces(6)
      .toFixed(),
  }));
}

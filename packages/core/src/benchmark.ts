import { Decimal } from '@vaultbench/shared/decimal';

import type { BenchmarkClose } from './types.js';

const ONE = new Decimal(1);
const BPS = new Decimal(10_000);

/** One entry swap, in basis points, charged against the buy-and-hold leg. */
export const DEFAULT_SWAP_COST_BPS = new Decimal(10);

export interface BenchmarkOptions {
  swapCostBps?: Decimal;
}

/**
 * Buy-and-hold counterfactual over the same window.
 *
 * The entry swap cost is deducted so the comparison is fair rather than
 * flattering to us: a real allocator pays to get into BTC, and pretending
 * otherwise hands the vault a handicap it did not earn.
 */
export function benchmarkTwr(
  closes: readonly BenchmarkClose[],
  options: BenchmarkOptions = {},
): Decimal | undefined {
  const start = closes[0];
  const end = closes[closes.length - 1];
  if (start === undefined || end === undefined || closes.length < 2) return undefined;
  if (start.closeUsd.lte(0)) return undefined;

  const swapCost = (options.swapCostBps ?? DEFAULT_SWAP_COST_BPS).div(BPS);
  const unitsAfterEntry = ONE.minus(swapCost);
  return end.closeUsd.div(start.closeUsd).times(unitsAfterEntry).minus(ONE);
}

/** Entity return minus the benchmark's over the same window. */
export function alpha(entityTwr: Decimal | undefined, benchTwr: Decimal | undefined): Decimal | undefined {
  if (entityTwr === undefined || benchTwr === undefined) return undefined;
  return entityTwr.minus(benchTwr);
}

/**
 * Restrict a close series to the window a NAV series actually covers, so the
 * benchmark is measured on the same start and end dates rather than on
 * whatever history the price feed happens to hold.
 */
export function alignCloses(
  closes: readonly BenchmarkClose[],
  startAsOf: string,
  endAsOf: string,
): BenchmarkClose[] {
  return closes
    .filter((close) => close.asOf >= startAsOf && close.asOf <= endAsOf)
    .sort((left, right) => (left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0));
}

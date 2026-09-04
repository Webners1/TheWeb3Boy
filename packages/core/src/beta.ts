import { Decimal } from '@vaultbench/shared/decimal';

import type { BenchmarkClose, NavPoint } from './types.js';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * How much of an entity's movement is just the benchmark, geared.
 *
 * This exists because alpha alone is misleading in a way that a chart makes
 * worse. The top entity by 90-day return in the live Chamber universe is a
 * vault called "Ethereum Bull 3X", reporting 174 points of alpha over ETH.
 * Every figure in that sentence is arithmetically correct and the conclusion
 * a reader draws from it is wrong: the vault is a 3x leveraged long on the
 * very benchmark it is being compared against, so that is beta times three in
 * a rising market, not manager skill. The same vault in a falling market
 * prints a spectacular *negative* alpha for the same reason, and neither
 * number says anything about the manager.
 *
 * Coverage metadata already travels with every figure. Leverage did not.
 * Publishing beta puts the gearing next to the alpha as a number, so the
 * reader does not have to infer it from a vault's name. See trap 21.
 */
export interface Beta {
  /**
   * Slope of the entity's returns against the benchmark's. 1 tracks it, 3 is
   * roughly three times geared, 0 is market-neutral, negative is short.
   */
  beta: Decimal;
  /**
   * Share of the entity's variance the benchmark explains, 0 to 1.
   *
   * Reported because beta on its own is not safe to publish. A beta of 3 with
   * an r² of 0.98 is a leveraged tracker; the same beta with an r² of 0.05 is
   * a coincidence of two noisy series, and presenting it as gearing would be
   * its own kind of lie.
   */
  rSquared: Decimal;
  /** Paired observations behind the figure. Fewer than ~20 is thin. */
  observations: number;
}

/**
 * Beta of a NAV series against a benchmark close series.
 *
 * The returns are paired over *identical intervals*, which is the part that
 * is easy to get wrong. An entity series may be `downsampled` to roughly
 * two-day spacing while the benchmark closes are daily; regressing 2-day
 * entity returns on 1-day benchmark returns would compare a step against
 * half a step, understating beta by around the square root of two and doing
 * it silently. So the benchmark return is measured between the same two dates
 * as the entity return, and any interval where either endpoint is missing is
 * dropped rather than approximated from a neighbouring day.
 *
 * Returns `undefined` rather than a number whenever the figure would not mean
 * anything: too few paired intervals, or a benchmark that did not move at all
 * over the window (a zero denominator is not a beta of zero, it is no beta).
 *
 * On a `downsampled` series the result is an estimate even when the pairing is
 * exact. A product rebalanced to 2x *daily* does not deliver 2x over a two-day
 * interval — two geared daily steps do not compose into one geared two-day
 * step, and the leftover convexity is the same effect that decays leveraged
 * ETFs in choppy markets. Measured on alternate days, a true 2x reads about
 * 2.11. So beta carries the sampling label for the same reason volatility and
 * drawdown do.
 */
export function beta(
  points: readonly NavPoint[],
  closes: readonly BenchmarkClose[],
): Beta | undefined {
  const closeByDate = new Map<string, Decimal>();
  for (const close of closes) closeByDate.set(close.asOf, close.closeUsd);

  const entityReturns: Decimal[] = [];
  const benchReturns: Decimal[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.valuePerUnit.lte(0)) continue;

    // Same two dates on both legs, or neither.
    const benchStart = closeByDate.get(previous.asOf);
    const benchEnd = closeByDate.get(current.asOf);
    if (benchStart === undefined || benchEnd === undefined) continue;
    if (benchStart.lte(0)) continue;

    entityReturns.push(current.valuePerUnit.div(previous.valuePerUnit).minus(ONE));
    benchReturns.push(benchEnd.div(benchStart).minus(ONE));
  }

  // Two points give one interval, which fits any slope perfectly and means
  // nothing. Three intervals is still thin, and `observations` says so.
  if (entityReturns.length < 3) return undefined;

  const count = new Decimal(entityReturns.length);
  const meanEntity = mean(entityReturns, count);
  const meanBench = mean(benchReturns, count);

  let covariance = ZERO;
  let benchVariance = ZERO;
  let entityVariance = ZERO;

  for (let index = 0; index < entityReturns.length; index += 1) {
    const entityDeviation = (entityReturns[index] ?? ZERO).minus(meanEntity);
    const benchDeviation = (benchReturns[index] ?? ZERO).minus(meanBench);
    covariance = covariance.plus(entityDeviation.times(benchDeviation));
    benchVariance = benchVariance.plus(benchDeviation.times(benchDeviation));
    entityVariance = entityVariance.plus(entityDeviation.times(entityDeviation));
  }

  // A benchmark that never moved has no slope to measure against.
  if (benchVariance.lte(0)) return undefined;

  const slope = covariance.div(benchVariance);
  // An entity that never moved is genuinely uncorrelated, not undefined:
  // beta is 0 and the benchmark explains none of its (absent) variance.
  const rSquared = entityVariance.lte(0)
    ? ZERO
    : covariance.times(covariance).div(benchVariance.times(entityVariance));

  return { beta: slope, rSquared, observations: entityReturns.length };
}

function mean(values: readonly Decimal[], count: Decimal): Decimal {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total.div(count);
}

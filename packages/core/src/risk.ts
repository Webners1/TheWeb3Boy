import { Decimal } from '@vaultbench/shared/decimal';

import { dayDiff } from './dates.js';
import { periodicReturns } from './twr.js';
import type { NavPoint, Sampling } from './types.js';

const ZERO = new Decimal(0);
const DAYS_PER_YEAR = new Decimal(365);

/**
 * Maximum peak-to-trough decline, as a non-negative fraction.
 *
 * On a `downsampled` series this understates the true figure, possibly badly
 * (trap 1) — the troughs between two biweekly points are simply not in the
 * data. Callers must publish it alongside its sampling label.
 */
export function maxDrawdown(points: readonly NavPoint[]): Decimal | undefined {
  if (points.length < 2) return undefined;

  let peak: Decimal | undefined;
  let worst = ZERO;

  for (const point of points) {
    const value = point.valuePerUnit;
    if (peak === undefined || value.gt(peak)) peak = value;
    if (peak === undefined || peak.lte(0)) continue;
    const decline = peak.minus(value).div(peak);
    if (decline.gt(worst)) worst = decline;
  }

  return worst;
}

export interface Volatility {
  /** Standard deviation of the per-step returns, unannualised. */
  perStep: Decimal;
  /** Scaled to a year using the observed mean step length. */
  annualised: Decimal;
  /** Mean days between observations — the honest basis of the scaling. */
  meanStepDays: Decimal;
  sampling: Sampling;
}

/**
 * Sample standard deviation of periodic returns, annualised by the *observed*
 * step length rather than an assumed daily cadence.
 *
 * A downsampled Hyperliquid series has irregular ~biweekly spacing, so
 * annualising it as if it were daily overstates volatility by roughly √14.
 * The mean step is returned so the caveat can be stated rather than hidden.
 */
export function volatility(points: readonly NavPoint[]): Volatility | undefined {
  const returns = periodicReturns(points);
  if (returns.length < 2) return undefined;

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return undefined;

  const spanDays = dayDiff(first.asOf, last.asOf);
  const steps = new Decimal(returns.length);
  const meanStepDays = spanDays > 0 ? new Decimal(spanDays).div(steps) : new Decimal(1);

  let total = ZERO;
  for (const value of returns) total = total.plus(value);
  const mean = total.div(steps);

  let sumSquares = ZERO;
  for (const value of returns) {
    const deviation = value.minus(mean);
    sumSquares = sumSquares.plus(deviation.times(deviation));
  }

  const variance = sumSquares.div(steps.minus(1));
  const perStep = variance.sqrt();
  const stepsPerYear = DAYS_PER_YEAR.div(meanStepDays);

  return {
    perStep,
    annualised: perStep.times(stepsPerYear.sqrt()),
    meanStepDays,
    sampling: points.some((point) => point.sampling === 'downsampled') ? 'downsampled' : 'daily',
  };
}

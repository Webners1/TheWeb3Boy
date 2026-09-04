import { Decimal } from '@vaultbench/shared/decimal';

import type { DepositorPoint } from './types.js';

/**
 * What a single depositor actually made, as a fraction of what they put in:
 *
 *     return = allTimePnl / (equity - allTimePnl)
 *
 * The denominator is the cost basis implied by current equity. A depositor who
 * has withdrawn their whole position sits at equity 0 with a non-zero PnL,
 * which makes the basis negative and the ratio meaningless — those rows are
 * skipped rather than clamped, because a fabricated -100% is worse than a gap.
 */
export function depositorReturn(depositor: DepositorPoint): Decimal | undefined {
  const { equity, allTimePnl } = depositor;
  if (equity === undefined || allTimePnl === undefined) return undefined;
  const basis = equity.minus(allTimePnl);
  if (basis.lte(0)) return undefined;
  return allTimePnl.div(basis);
}

export function median(values: readonly Decimal[]): Decimal | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left.cmp(right));
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return undefined;
  return lower.plus(upper).div(2);
}

export interface FollowerDistribution {
  /** Median realised depositor return. */
  medianReturn: Decimal;
  /** Depositors whose return could be computed. */
  counted: number;
  /** Depositors present but not computable (fully withdrawn, missing fields). */
  skipped: number;
}

export function followerDistribution(
  depositors: readonly DepositorPoint[],
): FollowerDistribution | undefined {
  const returns: Decimal[] = [];
  let skipped = 0;

  for (const depositor of depositors) {
    const value = depositorReturn(depositor);
    if (value === undefined) {
      skipped += 1;
      continue;
    }
    returns.push(value);
  }

  const medianReturn = median(returns);
  if (medianReturn === undefined) return undefined;

  return { medianReturn, counted: returns.length, skipped };
}

/**
 * Headline return minus what the median depositor actually realised. Positive
 * means the vault's advertised number flattered its own investors. Nobody else
 * publishes this, which is the point.
 */
export function followerGap(
  headline: Decimal | undefined,
  medianFollowerReturn: Decimal | undefined,
): Decimal | undefined {
  if (headline === undefined || medianFollowerReturn === undefined) return undefined;
  return headline.minus(medianFollowerReturn);
}

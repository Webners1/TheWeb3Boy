import { Decimal } from '@vaultbench/shared/decimal';

import type { NavQuality } from './types.js';

const ZERO = new Decimal(0);
const DAYS_PER_YEAR = new Decimal(365);

/** Whether the venue's published figure was already net of its own fees. */
export type FeeBasis = 'gross' | 'net';

export interface FeeProfile {
  /** Profit share / leader commission as a fraction, e.g. 0.1 for 10%. */
  profitShare?: Decimal;
  /** Annual management fee as a fraction. */
  managementFee?: Decimal;
  basis: FeeBasis;
}

export interface NetReturn {
  value: Decimal;
  /** False when the input was already net and no fee was applied. */
  feesApplied: boolean;
}

/**
 * Apply venue fees to a gross return.
 *
 * Profit share is charged on gains only — a losing period does not refund the
 * manager's cut. The management fee accrues with time, so it needs the window
 * length; charging a full annual fee to a 7-day window would be a fiction.
 *
 * When the venue already reports net of fees we return the input untouched and
 * say so, because applying the haircut twice is the easiest way to slander a
 * manager.
 */
export function netOfFees(
  grossReturn: Decimal,
  profile: FeeProfile,
  windowDays: number,
): NetReturn {
  if (profile.basis === 'net') {
    return { value: grossReturn, feesApplied: false };
  }

  const profitShare = profile.profitShare ?? ZERO;
  const managementFee = profile.managementFee ?? ZERO;

  const performanceFee = grossReturn.gt(0) ? grossReturn.times(profitShare) : ZERO;
  const timeWeightedManagement =
    windowDays > 0 ? managementFee.times(new Decimal(windowDays)).div(DAYS_PER_YEAR) : ZERO;

  return {
    value: grossReturn.minus(performanceFee).minus(timeWeightedManagement),
    feesApplied: !performanceFee.isZero() || !timeWeightedManagement.isZero(),
  };
}

/**
 * Reported money-weighted ROI and derived time-weighted return are different
 * quantities. Ranking them against each other is the lie every existing
 * leaderboard tells, so headline eligibility is decided here, once.
 */
export function isHeadlineEligible(navQuality: NavQuality): boolean {
  return navQuality === 'derived';
}

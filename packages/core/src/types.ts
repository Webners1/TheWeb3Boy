import type { Decimal } from '@vaultbench/shared/decimal';

export type Sampling = 'daily' | 'downsampled';

/**
 * How a per-unit value came to exist.
 *
 * `reported` — the venue publishes a true per-unit NAV or share price
 *              (Chamber's `adjustedTokenPrice`, Enzyme's share price). The
 *              best possible input: it is already time-weighted.
 * `derived`  — reconstructed from account value net of flows (Hyperliquid).
 * `roi`      — the venue publishes only a money-weighted return. It is *not*
 *              a per-unit NAV and must never be ranked against the other two.
 *
 * The distinction between `reported` and `roi` is the whole point. Collapsing
 * them into one "reported" bucket either excludes genuinely time-weighted
 * share prices from the rankings or admits money-weighted ROI into them, and
 * the second is the lie every existing leaderboard tells.
 */
export type NavQuality = 'reported' | 'derived' | 'roi';

/**
 * `reported` — passed through from a venue-published per-unit value.
 * `simple`   — no flow in the period, so ΔPnL / opening equity is exact.
 * `dietz`    — a flow occurred and its intra-period timing is unknown, so the
 *              denominator is mid-period weighted (Modified Dietz).
 */
export type NavMethod = 'reported' | 'simple' | 'dietz';

/** One raw snapshot row, as stored. Money values are Decimal, never floats. */
export interface SnapshotPoint {
  asOf: string;
  /** Present only when the venue publishes a per-unit value of some kind. */
  valuePerUnit?: Decimal;
  /**
   * How to label `valuePerUnit`. Defaults to `reported`; a source that only
   * publishes money-weighted ROI must say `roi` so it stays out of headlines.
   */
  navQuality?: Extract<NavQuality, 'reported' | 'roi'>;
  /** Flow-contaminated account value (trap 3). Not a return series. */
  accountValue?: Decimal;
  /** Cumulative PnL since inception (trap 2). Never differenced blindly. */
  cumPnl?: Decimal;
  sampling: Sampling;
}

export interface NavPoint {
  asOf: string;
  valuePerUnit: Decimal;
  navQuality: NavQuality;
  method: NavMethod;
  sampling: Sampling;
}

export interface FlowPoint {
  asOf: string;
  netFlowUsd: Decimal;
}

export interface BenchmarkClose {
  asOf: string;
  closeUsd: Decimal;
}

export interface DepositorPoint {
  depositor: string;
  equity?: Decimal;
  allTimePnl?: Decimal;
}

export interface WindowCoverage {
  daysCovered: number;
  isFullWindow: boolean;
  sampling: Sampling;
}

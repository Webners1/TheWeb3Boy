import type { Decimal } from '@vaultbench/shared/decimal';

export type Sampling = 'daily' | 'downsampled';

/** How a per-unit value came to exist. `raw` never appears in a NAV series. */
export type NavQuality = 'reported' | 'derived';

/**
 * `reported` — the venue published a per-unit NAV.
 * `simple`   — no flow in the period, so ΔPnL / opening equity is exact.
 * `dietz`    — a flow occurred and its intra-period timing is unknown, so the
 *              denominator is mid-period weighted (Modified Dietz).
 */
export type NavMethod = 'reported' | 'simple' | 'dietz';

/** One raw snapshot row, as stored. Money values are Decimal, never floats. */
export interface SnapshotPoint {
  asOf: string;
  /** Present only when the venue publishes a true per-unit NAV. */
  valuePerUnit?: Decimal;
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

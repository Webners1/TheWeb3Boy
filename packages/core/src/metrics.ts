import type { Decimal } from '@vaultbench/shared/decimal';

import { alignCloses, alpha, benchmarkTwr } from './benchmark.js';
import { beta, type Beta } from './beta.js';
import { isHeadlineEligible, netOfFees, type FeeProfile } from './fees.js';
import { followerDistribution, followerGap } from './followers.js';
import { maxDrawdown, volatility } from './risk.js';
import { selectWindow } from './series.js';
import { twr } from './twr.js';
import type {
  BenchmarkClose,
  DepositorPoint,
  NavPoint,
  NavQuality,
  Sampling,
} from './types.js';

export interface BenchmarkCloses {
  BTC?: readonly BenchmarkClose[];
  ETH?: readonly BenchmarkClose[];
  SOL?: readonly BenchmarkClose[];
}

export interface MetricsInput {
  nav: readonly NavPoint[];
  endAsOf: string;
  windowDays: number;
  benchmarks: BenchmarkCloses;
  depositors?: readonly DepositorPoint[];
  fees: FeeProfile;
}

export interface EntityMetrics {
  windowDays: number;
  asOf: string;
  twr?: Decimal;
  benchTwrBtc?: Decimal;
  benchTwrEth?: Decimal;
  benchTwrSol?: Decimal;
  alphaBtc?: Decimal;
  alphaEth?: Decimal;
  alphaSol?: Decimal;
  /**
   * Gearing against each benchmark, with the share of variance it explains.
   *
   * Published alongside alpha because alpha without it invites the reader to
   * call leverage skill. See `beta.ts` and trap 21.
   */
  betaBtc?: Decimal;
  betaEth?: Decimal;
  betaSol?: Decimal;
  rSquaredBtc?: Decimal;
  rSquaredEth?: Decimal;
  rSquaredSol?: Decimal;
  maxDrawdown?: Decimal;
  volatility?: Decimal;
  followerMedianReturn?: Decimal;
  followerGap?: Decimal;
  daysCovered: number;
  isFullWindow: boolean;
  sampling: Sampling;
  navQuality?: NavQuality;
  /** False for venues that only publish money-weighted ROI. */
  headlineEligible: boolean;
  feesApplied: boolean;
}

/**
 * Everything derivable about one entity over one window, from snapshots alone.
 *
 * Pure: no clock, no database, no network. That is what lets the API, the MCP
 * server and any future backtester share one implementation, and what makes
 * the maths testable against fixtures instead of against production.
 */
export function computeEntityMetrics(input: MetricsInput): EntityMetrics {
  const window = selectWindow(input.nav, input.endAsOf, input.windowDays);
  const first = window.points[0];
  const last = window.points[window.points.length - 1];

  const base: EntityMetrics = {
    windowDays: input.windowDays,
    asOf: input.endAsOf,
    daysCovered: window.daysCovered,
    isFullWindow: window.isFullWindow,
    sampling: window.sampling,
    navQuality: last?.navQuality,
    headlineEligible: last === undefined ? false : isHeadlineEligible(last.navQuality),
    feesApplied: false,
  };

  if (first === undefined || last === undefined) return base;

  const grossTwr = twr(window.points);
  let netTwr: Decimal | undefined;
  let feesApplied = false;
  if (grossTwr !== undefined) {
    const net = netOfFees(grossTwr, input.fees, window.daysCovered);
    netTwr = net.value;
    feesApplied = net.feesApplied;
  }

  const benchmarkFor = (closes: readonly BenchmarkClose[] | undefined): Decimal | undefined => {
    if (closes === undefined) return undefined;
    return benchmarkTwr(alignCloses(closes, first.asOf, last.asOf));
  };

  const benchBtc = benchmarkFor(input.benchmarks.BTC);
  const benchEth = benchmarkFor(input.benchmarks.ETH);
  const benchSol = benchmarkFor(input.benchmarks.SOL);

  // Beta uses the same window and the same aligned closes as alpha, so the
  // two are always describing one comparison rather than two.
  const betaFor = (closes: readonly BenchmarkClose[] | undefined): Beta | undefined => {
    if (closes === undefined) return undefined;
    return beta(window.points, alignCloses(closes, first.asOf, last.asOf));
  };

  const betaBtc = betaFor(input.benchmarks.BTC);
  const betaEth = betaFor(input.benchmarks.ETH);
  const betaSol = betaFor(input.benchmarks.SOL);

  const followers = input.depositors ? followerDistribution(input.depositors) : undefined;
  const vol = volatility(window.points);

  return {
    ...base,
    twr: netTwr,
    benchTwrBtc: benchBtc,
    benchTwrEth: benchEth,
    benchTwrSol: benchSol,
    alphaBtc: alpha(netTwr, benchBtc),
    alphaEth: alpha(netTwr, benchEth),
    alphaSol: alpha(netTwr, benchSol),
    betaBtc: betaBtc?.beta,
    betaEth: betaEth?.beta,
    betaSol: betaSol?.beta,
    rSquaredBtc: betaBtc?.rSquared,
    rSquaredEth: betaEth?.rSquared,
    rSquaredSol: betaSol?.rSquared,
    maxDrawdown: maxDrawdown(window.points),
    volatility: vol?.annualised,
    followerMedianReturn: followers?.medianReturn,
    followerGap: followerGap(netTwr, followers?.medianReturn),
    feesApplied,
  };
}

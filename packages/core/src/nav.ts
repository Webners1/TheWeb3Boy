import { Decimal } from '@vaultbench/shared/decimal';

import { HALF } from './flows.js';
import type { NavPoint, SnapshotPoint } from './types.js';

export interface NavSeries {
  points: NavPoint[];
  /**
   * Number of periods the chain could not cross (equity reached zero or went
   * negative). A break truncates the series — it is never bridged, because
   * bridging invents a return nobody earned.
   */
  breaks: number;
}

const ONE = new Decimal(1);

/**
 * Build a per-unit value series — the atom every metric is computed from.
 *
 * Where the venue publishes a per-unit NAV we pass it through untouched.
 * Where it publishes account value and cumulative PnL (Hyperliquid) we
 * chain-link sub-period returns, neutralising flows:
 *
 *     r[t] = ΔPnL[t] / (A[t-1] + 0.5 × netFlow[t])
 *     v[t] = v[t-1] × (1 + r[t])
 *
 * The mid-period flow weight is Modified Dietz: a daily snapshot does not
 * reveal when inside the day a deposit landed. When there is no flow the
 * denominator collapses to opening equity and the return is exact, which is
 * why the method is recorded per point rather than per series.
 *
 * The index starts at 1. It is an index, not a share price — only its ratios
 * are meaningful, which is all TWR ever asks of it.
 */
export function deriveNavSeries(points: readonly SnapshotPoint[]): NavSeries {
  const reported = reportedSeries(points);
  if (reported) return reported;

  const usable = points.filter(
    (point) => point.accountValue !== undefined && point.cumPnl !== undefined,
  );
  if (usable.length === 0) return { points: [], breaks: 0 };

  const first = usable[0];
  if (first === undefined) return { points: [], breaks: 0 };

  const out: NavPoint[] = [
    {
      asOf: first.asOf,
      valuePerUnit: ONE,
      navQuality: 'derived',
      method: 'simple',
      sampling: first.sampling,
    },
  ];

  let index = ONE;
  let breaks = 0;

  for (let i = 1; i < usable.length; i += 1) {
    const previous = usable[i - 1];
    const current = usable[i];
    if (previous === undefined || current === undefined) break;

    const openingEquity = previous.accountValue;
    const closingEquity = current.accountValue;
    const openingPnl = previous.cumPnl;
    const closingPnl = current.cumPnl;
    if (
      openingEquity === undefined ||
      closingEquity === undefined ||
      openingPnl === undefined ||
      closingPnl === undefined
    ) {
      break;
    }

    const periodPnl = closingPnl.minus(openingPnl);
    const netFlow = closingEquity.minus(openingEquity).minus(periodPnl);
    const denominator = openingEquity.plus(netFlow.times(HALF));

    if (denominator.lte(0)) {
      breaks += 1;
      break;
    }

    const periodReturn = periodPnl.div(denominator);
    const next = index.times(ONE.plus(periodReturn));
    if (next.lt(0)) {
      breaks += 1;
      break;
    }

    index = next;
    out.push({
      asOf: current.asOf,
      valuePerUnit: index,
      navQuality: 'derived',
      method: netFlow.isZero() ? 'simple' : 'dietz',
      sampling: current.sampling,
    });

    // A total wipeout is a real -100% and gets recorded. What it cannot do is
    // compound: nothing multiplies out of zero, so the chain ends here rather
    // than treating a later deposit as a recovery.
    if (index.isZero()) {
      breaks += 1;
      break;
    }
  }

  return { points: out, breaks };
}

function reportedSeries(points: readonly SnapshotPoint[]): NavSeries | undefined {
  const reported = points.filter((point) => point.valuePerUnit !== undefined);
  if (reported.length === 0 || reported.length !== points.length) return undefined;

  const out: NavPoint[] = [];
  for (const point of reported) {
    const value = point.valuePerUnit;
    if (value === undefined || value.lte(0)) continue;
    out.push({
      asOf: point.asOf,
      valuePerUnit: value,
      // A published share price stays `reported`; a published ROI stays
      // `roi` and is carried all the way through to headline eligibility.
      navQuality: point.navQuality ?? 'reported',
      method: 'reported',
      sampling: point.sampling,
    });
  }
  return { points: out, breaks: 0 };
}

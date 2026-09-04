import { addDaysIso, dayDiff } from './dates.js';
import type { NavPoint, Sampling, WindowCoverage } from './types.js';

/** `0` means "since inception" — every point available, no fabricated start. */
export const INCEPTION_WINDOW = 0;

export const DEFAULT_WINDOWS = [7, 30, 90, 365, INCEPTION_WINDOW] as const;

export interface WindowSelection extends WindowCoverage {
  points: NavPoint[];
}

/**
 * Take the slice of a NAV series that a window actually contains.
 *
 * `daysCovered` is the observed span, not the requested one, and
 * `isFullWindow` is false whenever the entity's history is shorter than asked.
 * Nothing is extrapolated back to the window start: a 12-day-old vault has a
 * 12-day record, and calling that a 30-day return is how leaderboards lie.
 */
export function selectWindow(
  points: readonly NavPoint[],
  endAsOf: string,
  windowDays: number,
): WindowSelection {
  const ordered = [...points].sort((left, right) =>
    left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0,
  );

  const startBound =
    windowDays === INCEPTION_WINDOW ? undefined : addDaysIso(endAsOf, -(windowDays - 1));

  const selected = ordered.filter(
    (point) => point.asOf <= endAsOf && (startBound === undefined || point.asOf >= startBound),
  );

  const first = selected[0];
  const last = selected[selected.length - 1];
  const daysCovered =
    first === undefined || last === undefined ? 0 : dayDiff(first.asOf, last.asOf) + 1;

  return {
    points: selected,
    daysCovered,
    isFullWindow:
      windowDays === INCEPTION_WINDOW
        ? selected.length > 1
        : spansWindow(ordered, selected, startBound, endAsOf),
    sampling: classifySampling(selected),
  };
}

/**
 * Does the record actually cover the window at both ends?
 *
 * Not `daysCovered >= windowDays`, which was the obvious test and the wrong
 * one. On a series sampled every two days, whether an observation lands
 * exactly on the cutoff date is a parity coin-flip against the window
 * length — so a three-year-old vault reported `isFullWindow: false` for a
 * 90-day window while reporting `true` for 365. Non-monotonic, and it made
 * the one field a reader checks before trusting a figure answer a different
 * question from the one they were asking.
 *
 * Two things have to hold, and they are the two ways a window genuinely
 * fails to be full:
 *
 * 1. The record began at or before the window opened. Otherwise the entity
 *    is younger than the window and this is not a 90-day return at all.
 * 2. The record still runs to the window's end, within one sampling step.
 *    Otherwise the figure is stale — a vault that stopped reporting two
 *    months ago must not present its last reading as current.
 */
function spansWindow(
  all: readonly NavPoint[],
  selected: readonly NavPoint[],
  startBound: string | undefined,
  endAsOf: string,
): boolean {
  const last = selected[selected.length - 1];
  if (last === undefined || startBound === undefined) return false;

  // Looks at every point, not just the selected slice: an observation before
  // the window is exactly the evidence that the record predates it.
  const beganBeforeWindow = all.some((point) => point.asOf <= startBound);

  // One step of tolerance, because a two-day series cannot be expected to
  // land on the final date. Zero tolerance would fail every downsampled
  // window; unlimited tolerance would call a dead vault current.
  const runsToWindowEnd = dayDiff(last.asOf, endAsOf) <= samplingStepDays(selected);

  return beganBeforeWindow && runsToWindowEnd;
}

/**
 * The largest gap between consecutive observations, in days. Used as the
 * staleness tolerance, so an irregular series is judged by its own coarsest
 * spacing rather than by an assumed daily cadence.
 */
export function samplingStepDays(points: readonly NavPoint[]): number {
  let widest = 1;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    widest = Math.max(widest, dayDiff(previous.asOf, current.asOf));
  }
  return widest;
}

/**
 * Mixed sampling degrades to `downsampled`. A window that straddles the
 * backfill/forward boundary is only as trustworthy as its coarsest point.
 */
export function classifySampling(points: readonly NavPoint[]): Sampling {
  return points.some((point) => point.sampling === 'downsampled') ? 'downsampled' : 'daily';
}

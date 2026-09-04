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
    isFullWindow: windowDays === INCEPTION_WINDOW ? selected.length > 1 : daysCovered >= windowDays,
    sampling: classifySampling(selected),
  };
}

/**
 * Mixed sampling degrades to `downsampled`. A window that straddles the
 * backfill/forward boundary is only as trustworthy as its coarsest point.
 */
export function classifySampling(points: readonly NavPoint[]): Sampling {
  return points.some((point) => point.sampling === 'downsampled') ? 'downsampled' : 'daily';
}

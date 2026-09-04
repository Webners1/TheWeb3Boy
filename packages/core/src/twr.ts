import { Decimal } from '@vaultbench/shared/decimal';

import type { NavPoint } from './types.js';

const ONE = new Decimal(1);

/**
 * Time-weighted return over a per-unit value series: `v[end] / v[start] - 1`.
 *
 * Per-unit value already neutralises flows, which is the whole reason it is
 * the atom. Fewer than two points is not a short return, it is no return —
 * hence `undefined` rather than zero.
 */
export function twr(points: readonly NavPoint[]): Decimal | undefined {
  const start = points[0];
  const end = points[points.length - 1];
  if (start === undefined || end === undefined || points.length < 2) return undefined;
  if (start.valuePerUnit.lte(0)) return undefined;
  return end.valuePerUnit.div(start.valuePerUnit).minus(ONE);
}

/** Step-over-step simple returns. Length is one less than the input. */
export function periodicReturns(points: readonly NavPoint[]): Decimal[] {
  const returns: Decimal[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.valuePerUnit.lte(0)) continue;
    returns.push(current.valuePerUnit.div(previous.valuePerUnit).minus(ONE));
  }
  return returns;
}

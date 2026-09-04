import { Decimal } from '@vaultbench/shared/decimal';

import type { FlowPoint, SnapshotPoint } from './types.js';

/**
 * Reconstruct net deposits/withdrawals between consecutive snapshots.
 *
 * `accountValue` moves with both trading PnL and flows (trap 3), while
 * `cumPnl` is cumulative trading PnL since inception (trap 2). What is left
 * after removing the PnL move is the flow:
 *
 *     netFlow[t] = (A[t] - A[t-1]) - (P[t] - P[t-1])
 *
 * The first snapshot has no predecessor and therefore no derivable flow — the
 * opening balance is not a deposit we observed.
 */
export function deriveFlows(points: readonly SnapshotPoint[]): FlowPoint[] {
  const flows: FlowPoint[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous === undefined || current === undefined) continue;
    if (
      previous.accountValue === undefined ||
      current.accountValue === undefined ||
      previous.cumPnl === undefined ||
      current.cumPnl === undefined
    ) {
      continue;
    }

    const valueMove = current.accountValue.minus(previous.accountValue);
    const pnlMove = current.cumPnl.minus(previous.cumPnl);
    flows.push({ asOf: current.asOf, netFlowUsd: valueMove.minus(pnlMove) });
  }

  return flows;
}

export const HALF = new Decimal('0.5');

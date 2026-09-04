export type RowBand = 'ok' | 'aborted';

/**
 * Empty-array guard (trap 4). An HTTP 200 with `[]` is a valid response and
 * the failure mode that silently destroys the dataset. The same guard applies
 * to a recompute that suddenly produces nothing.
 *
 * Band: rows_written must sit in [50%, 150%] of the previous successful run's
 * rows_written. Integer arithmetic only: 2*written < expected is "< 50%";
 * 2*written > 3*expected is "> 150%".
 *
 * A first run (no expected count) is allowed unless it wrote zero rows.
 */
export function evaluateRowBand(written: number, expected: number | null): RowBand {
  if (written === 0) return 'aborted';
  if (expected === null) return 'ok';
  if (written * 2 < expected || written * 2 > expected * 3) return 'aborted';
  return 'ok';
}

/** A run that stopped itself rather than write partial or absurd data. */
export class RunAbortError extends Error {
  readonly status: 'aborted' | 'failed';

  constructor(message: string, status: 'aborted' | 'failed' = 'aborted') {
    super(message);
    this.name = 'RunAbortError';
    this.status = status;
  }
}

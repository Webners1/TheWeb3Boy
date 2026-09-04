export type RowBand = 'ok' | 'aborted';

/**
 * Empty-array guard (trap 4). An HTTP 200 with `[]` is a valid response and
 * the failure mode that silently destroys the dataset.
 *
 * Band: rows_written must sit in [50%, 150%] of the previous successful
 * run's rows_written. Integer arithmetic only: 2*written < expected is
 * "< 50%"; 2*written > 3*expected is "> 150%".
 *
 * A first run (no expected count) is allowed unless it wrote zero rows.
 */
export function evaluateRowBand(written: number, expected: number | null): RowBand {
  if (written === 0) return 'aborted';
  if (expected === null) return 'ok';
  if (written * 2 < expected || written * 2 > expected * 3) return 'aborted';
  return 'ok';
}

export function shouldApplySnapshot(existingSampling: string | undefined, incomingSampling: string): boolean {
  // Never overwrite a daily row with a downsampled one.
  if (existingSampling === 'daily' && incomingSampling === 'downsampled') {
    return false;
  }
  return true;
}

export interface TrackedMetadata {
  name: string | null;
  strategyCategory: string | null;
  feeProfitShare: string | null;
  feeManagement: string | null;
  leaderCommission: string | null;
  status: string | null;
}

export function metadataChanged(current: TrackedMetadata, next: TrackedMetadata): boolean {
  return (
    current.name !== next.name ||
    current.strategyCategory !== next.strategyCategory ||
    current.feeProfitShare !== next.feeProfitShare ||
    current.feeManagement !== next.feeManagement ||
    current.leaderCommission !== next.leaderCommission ||
    current.status !== next.status
  );
}

export class IngestAbortError extends Error {
  readonly status: 'aborted' | 'failed';

  constructor(message: string, status: 'aborted' | 'failed' = 'aborted') {
    super(message);
    this.name = 'IngestAbortError';
    this.status = status;
  }
}

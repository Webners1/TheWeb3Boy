import { RunAbortError } from '@vaultbench/shared';

// The row band lives in @vaultbench/shared because the recompute job needs
// the same guard: a derived pass that suddenly writes nothing is the same
// silent failure as a source returning [].
export { evaluateRowBand, type RowBand } from '@vaultbench/shared';

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

export class IngestAbortError extends RunAbortError {
  constructor(message: string, status: 'aborted' | 'failed' = 'aborted') {
    super(message, status);
    this.name = 'IngestAbortError';
  }
}

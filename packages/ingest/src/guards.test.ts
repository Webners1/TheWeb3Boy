import { describe, expect, it } from 'vitest';

import { evaluateRowBand, metadataChanged, shouldApplySnapshot } from './guards.js';

describe('evaluateRowBand', () => {
  it('aborts on an empty write even on the first run', () => {
    expect(evaluateRowBand(0, null)).toBe('aborted');
  });

  it('allows the first non-empty run', () => {
    expect(evaluateRowBand(100, null)).toBe('ok');
  });

  it('aborts below 50% of yesterday', () => {
    expect(evaluateRowBand(49, 100)).toBe('aborted');
    expect(evaluateRowBand(50, 100)).toBe('ok');
  });

  it('aborts above 150% of yesterday', () => {
    expect(evaluateRowBand(151, 100)).toBe('aborted');
    expect(evaluateRowBand(150, 100)).toBe('ok');
  });
});

describe('shouldApplySnapshot', () => {
  it('refuses to overwrite daily with downsampled', () => {
    expect(shouldApplySnapshot('daily', 'downsampled')).toBe(false);
  });

  it('allows daily to overwrite downsampled and same-kind upserts', () => {
    expect(shouldApplySnapshot('downsampled', 'daily')).toBe(true);
    expect(shouldApplySnapshot('daily', 'daily')).toBe(true);
    expect(shouldApplySnapshot('downsampled', 'downsampled')).toBe(true);
    expect(shouldApplySnapshot(undefined, 'downsampled')).toBe(true);
  });
});

describe('metadataChanged', () => {
  const base = {
    name: 'Vault',
    strategyCategory: null,
    feeProfitShare: null,
    feeManagement: null,
    leaderCommission: '0.1000',
    status: 'active',
  };

  it('detects a fee change', () => {
    expect(metadataChanged(base, { ...base, leaderCommission: '0.2000' })).toBe(true);
  });

  it('is stable when nothing tracked moved', () => {
    expect(metadataChanged(base, { ...base })).toBe(false);
  });
});

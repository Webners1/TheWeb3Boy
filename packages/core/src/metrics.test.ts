import { Decimal } from '@vaultbench/shared/decimal';
import { describe, expect, it } from 'vitest';

import { benchmarkTwr } from './benchmark.js';
import { netOfFees } from './fees.js';
import { depositorReturn, followerDistribution, followerGap, median } from './followers.js';
import { computeEntityMetrics } from './metrics.js';
import { maxDrawdown, volatility } from './risk.js';
import { INCEPTION_WINDOW, selectWindow } from './series.js';
import type { BenchmarkClose, NavPoint } from './types.js';

function nav(asOf: string, value: string, sampling: 'daily' | 'downsampled' = 'daily'): NavPoint {
  return {
    asOf,
    valuePerUnit: new Decimal(value),
    navQuality: 'derived',
    method: 'simple',
    sampling,
  };
}

function close(asOf: string, price: string): BenchmarkClose {
  return { asOf, closeUsd: new Decimal(price) };
}

describe('benchmarkTwr', () => {
  it('charges one entry swap so the comparison is not flattering', () => {
    const doubled = [close('2026-01-01', '100'), close('2026-01-31', '200')];
    expect(benchmarkTwr(doubled)?.toFixed()).toBe('0.998');
  });

  it('needs two points to be a return at all', () => {
    expect(benchmarkTwr([close('2026-01-01', '100')])).toBeUndefined();
  });
});

describe('maxDrawdown', () => {
  it('measures peak to trough, not first to last', () => {
    const points = [nav('2026-01-01', '1'), nav('2026-01-02', '1.1'), nav('2026-01-03', '0.55'), nav('2026-01-04', '0.8')];
    expect(maxDrawdown(points)?.toFixed()).toBe('0.5');
  });

  it('is zero for a monotonic climb', () => {
    expect(maxDrawdown([nav('2026-01-01', '1'), nav('2026-01-02', '2')])?.toFixed()).toBe('0');
  });
});

describe('volatility', () => {
  it('annualises by the observed step, not an assumed daily cadence', () => {
    const daily = [nav('2026-01-01', '1'), nav('2026-01-02', '1.1'), nav('2026-01-03', '1.1'), nav('2026-01-04', '1.21')];
    const biweekly = [nav('2026-01-01', '1', 'downsampled'), nav('2026-01-15', '1.1', 'downsampled'), nav('2026-01-29', '1.1', 'downsampled'), nav('2026-02-12', '1.21', 'downsampled')];

    const dailyVol = volatility(daily);
    const coarseVol = volatility(biweekly);
    expect(dailyVol?.perStep.toFixed(6)).toBe(coarseVol?.perStep.toFixed(6));
    expect(dailyVol?.meanStepDays.toFixed()).toBe('1');
    expect(coarseVol?.meanStepDays.toFixed()).toBe('14');
    // Same shape, coarser spacing: annualising the coarse series must not
    // inflate it by the sqrt(14) an assumed-daily cadence would apply.
    expect(coarseVol?.annualised.lt(dailyVol?.annualised ?? new Decimal(0))).toBe(true);
  });

  it('flags a mixed-sampling window as downsampled', () => {
    const mixed = [nav('2026-01-01', '1', 'downsampled'), nav('2026-01-02', '1.1'), nav('2026-01-03', '1.2')];
    expect(volatility(mixed)?.sampling).toBe('downsampled');
  });
});

describe('depositor returns', () => {
  it('measures return against implied cost basis', () => {
    expect(
      depositorReturn({ depositor: 'a', equity: new Decimal('150'), allTimePnl: new Decimal('50') })?.toFixed(),
    ).toBe('0.5');
  });

  it('skips a fully withdrawn depositor rather than inventing -100%', () => {
    expect(
      depositorReturn({ depositor: 'b', equity: new Decimal('0'), allTimePnl: new Decimal('10') }),
    ).toBeUndefined();
  });

  it('takes the median of the computable cross-section and counts the rest', () => {
    const distribution = followerDistribution([
      { depositor: 'a', equity: new Decimal('150'), allTimePnl: new Decimal('50') },
      { depositor: 'b', equity: new Decimal('100'), allTimePnl: new Decimal('0') },
      { depositor: 'c', equity: new Decimal('0'), allTimePnl: new Decimal('10') },
    ]);
    expect(distribution?.medianReturn.toFixed()).toBe('0.25');
    expect(distribution?.counted).toBe(2);
    expect(distribution?.skipped).toBe(1);
  });

  it('averages the two middle values on an even cross-section', () => {
    expect(median([new Decimal('0'), new Decimal('1')])?.toFixed()).toBe('0.5');
  });

  it('reports the gap between the headline and the median investor', () => {
    expect(followerGap(new Decimal('0.4'), new Decimal('0.25'))?.toFixed()).toBe('0.15');
  });
});

describe('netOfFees', () => {
  it('charges profit share on gains and prorates the management fee', () => {
    const net = netOfFees(
      new Decimal('0.2'),
      { profitShare: new Decimal('0.1'), managementFee: new Decimal('0.02'), basis: 'gross' },
      365,
    );
    expect(net.value.toFixed()).toBe('0.16');
    expect(net.feesApplied).toBe(true);
  });

  it('does not charge profit share on a loss', () => {
    const net = netOfFees(
      new Decimal('-0.2'),
      { profitShare: new Decimal('0.1'), basis: 'gross' },
      30,
    );
    expect(net.value.toFixed()).toBe('-0.2');
  });

  it('leaves an already-net figure untouched', () => {
    const net = netOfFees(
      new Decimal('0.2'),
      { profitShare: new Decimal('0.1'), basis: 'net' },
      365,
    );
    expect(net.value.toFixed()).toBe('0.2');
    expect(net.feesApplied).toBe(false);
  });
});

describe('selectWindow', () => {
  const points = [nav('2026-01-01', '1'), nav('2026-01-05', '1.1'), nav('2026-01-10', '1.2')];

  it('refuses to call a 10-day history a 30-day return', () => {
    const window = selectWindow(points, '2026-01-10', 30);
    expect(window.daysCovered).toBe(10);
    expect(window.isFullWindow).toBe(false);
  });

  it('clips to the requested window and reports the observed span only', () => {
    const window = selectWindow(points, '2026-01-10', 7);
    expect(window.points.map((point) => point.asOf)).toEqual(['2026-01-05', '2026-01-10']);
    expect(window.daysCovered).toBe(6);
    expect(window.isFullWindow).toBe(false);
  });

  it('takes everything for the inception window', () => {
    const window = selectWindow(points, '2026-01-10', INCEPTION_WINDOW);
    expect(window.points).toHaveLength(3);
    expect(window.isFullWindow).toBe(true);
  });
});

describe('computeEntityMetrics', () => {
  const points = [nav('2026-01-01', '1'), nav('2026-01-15', '1.1'), nav('2026-01-31', '1.2')];
  const btc = [close('2026-01-01', '100'), close('2026-01-15', '150'), close('2026-01-31', '200')];

  it('computes alpha against the same start and end dates', () => {
    const metrics = computeEntityMetrics({
      nav: points,
      endAsOf: '2026-01-31',
      windowDays: 31,
      benchmarks: { BTC: btc },
      fees: { basis: 'net' },
    });

    expect(metrics.twr?.toFixed()).toBe('0.2');
    expect(metrics.benchTwrBtc?.toFixed()).toBe('0.998');
    expect(metrics.alphaBtc?.toFixed()).toBe('-0.798');
    expect(metrics.isFullWindow).toBe(true);
    expect(metrics.headlineEligible).toBe(true);
  });

  it('excludes money-weighted ROI from headline eligibility', () => {
    const roi = points.map((point) => ({ ...point, navQuality: 'roi' as const }));
    const metrics = computeEntityMetrics({
      nav: roi,
      endAsOf: '2026-01-31',
      windowDays: 31,
      benchmarks: {},
      fees: { basis: 'net' },
    });
    expect(metrics.navQuality).toBe('roi');
    expect(metrics.headlineEligible).toBe(false);
  });

  it('keeps a venue-published per-unit NAV headline eligible', () => {
    // A real share price is already time-weighted — a better input than our
    // own reconstruction, so excluding it would be the opposite error.
    const reported = points.map((point) => ({ ...point, navQuality: 'reported' as const }));
    const metrics = computeEntityMetrics({
      nav: reported,
      endAsOf: '2026-01-31',
      windowDays: 31,
      benchmarks: {},
      fees: { basis: 'net' },
    });
    expect(metrics.headlineEligible).toBe(true);
  });

  it('returns coverage without metrics when the window is empty', () => {
    const metrics = computeEntityMetrics({
      nav: points,
      endAsOf: '2025-06-01',
      windowDays: 30,
      benchmarks: { BTC: btc },
      fees: { basis: 'net' },
    });
    expect(metrics.twr).toBeUndefined();
    expect(metrics.daysCovered).toBe(0);
    expect(metrics.isFullWindow).toBe(false);
  });

  it('omits a benchmark it has no prices for instead of guessing', () => {
    const metrics = computeEntityMetrics({
      nav: points,
      endAsOf: '2026-01-31',
      windowDays: 31,
      benchmarks: { BTC: btc },
      fees: { basis: 'net' },
    });
    expect(metrics.benchTwrEth).toBeUndefined();
    expect(metrics.alphaEth).toBeUndefined();
  });
});

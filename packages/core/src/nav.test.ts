import { Decimal } from '@vaultbench/shared/decimal';
import { describe, expect, it } from 'vitest';

import { deriveFlows } from './flows.js';
import { deriveNavSeries } from './nav.js';
import { twr } from './twr.js';
import type { SnapshotPoint } from './types.js';

function point(asOf: string, accountValue: string, cumPnl: string): SnapshotPoint {
  return {
    asOf,
    accountValue: new Decimal(accountValue),
    cumPnl: new Decimal(cumPnl),
    sampling: 'daily',
  };
}

/**
 * A vault that earns 10%, takes a 10,000 deposit, then earns 10% again.
 * The deposit is nine times the fund's size and must not register as return.
 */
const series: SnapshotPoint[] = [
  point('2026-01-01', '1000', '0'),
  point('2026-01-02', '1100', '100'),
  point('2026-01-03', '11100', '100'),
  point('2026-01-04', '12210', '1210'),
];

describe('deriveFlows', () => {
  it('separates a deposit from trading PnL', () => {
    const flows = deriveFlows(series);
    expect(flows.map((flow) => [flow.asOf, flow.netFlowUsd.toFixed()])).toEqual([
      ['2026-01-02', '0'],
      ['2026-01-03', '10000'],
      ['2026-01-04', '0'],
    ]);
  });

  it('has no flow for the opening snapshot', () => {
    expect(deriveFlows(series)[0]?.asOf).toBe('2026-01-02');
  });
});

describe('deriveNavSeries', () => {
  it('neutralises flows so a deposit does not move the index', () => {
    const { points, breaks } = deriveNavSeries(series);
    expect(breaks).toBe(0);
    expect(points.map((navPoint) => navPoint.valuePerUnit.toFixed())).toEqual([
      '1',
      '1.1',
      '1.1',
      '1.21',
    ]);
  });

  it('records Modified Dietz only for the period that had a flow', () => {
    const { points } = deriveNavSeries(series);
    expect(points.map((navPoint) => navPoint.method)).toEqual([
      'simple',
      'simple',
      'dietz',
      'simple',
    ]);
  });

  it('yields a 21% time-weighted return despite the 10x deposit', () => {
    const { points } = deriveNavSeries(series);
    expect(twr(points)?.toFixed()).toBe('0.21');
  });

  it('marks the series derived, never reported', () => {
    const { points } = deriveNavSeries(series);
    expect(points.every((navPoint) => navPoint.navQuality === 'derived')).toBe(true);
  });

  it('truncates rather than bridging a wipeout to zero equity', () => {
    const wiped = [
      point('2026-01-01', '1000', '0'),
      point('2026-01-02', '0', '-1000'),
      point('2026-01-03', '500', '-1000'),
    ];
    const { points, breaks } = deriveNavSeries(wiped);
    expect(points).toHaveLength(2);
    expect(points[1]?.valuePerUnit.toFixed()).toBe('0');
    expect(breaks).toBe(1);
  });

  it('passes a venue-reported per-unit NAV through untouched', () => {
    const reported: SnapshotPoint[] = [
      { asOf: '2026-01-01', valuePerUnit: new Decimal('1.5'), sampling: 'daily' },
      { asOf: '2026-01-02', valuePerUnit: new Decimal('1.65'), sampling: 'daily' },
    ];
    const { points } = deriveNavSeries(reported);
    expect(points.map((navPoint) => navPoint.valuePerUnit.toFixed())).toEqual(['1.5', '1.65']);
    expect(points.every((navPoint) => navPoint.navQuality === 'reported')).toBe(true);
    expect(twr(points)?.toFixed()).toBe('0.1');
  });

  it('does not treat account value deltas as performance', () => {
    // Pure deposit, zero trading: the naive answer is +900%, the right one is 0.
    const depositOnly = [point('2026-01-01', '1000', '0'), point('2026-01-02', '10000', '0')];
    const { points } = deriveNavSeries(depositOnly);
    expect(twr(points)?.toFixed()).toBe('0');
  });

  it('holds full precision on a realistic Hyperliquid value', () => {
    const precise = [
      point('2026-01-01', '329265410.90790099', '0'),
      point('2026-01-02', '329265410.90790099', '0'),
    ];
    const { points } = deriveNavSeries(precise);
    expect(points[1]?.valuePerUnit.toFixed()).toBe('1');
  });
});

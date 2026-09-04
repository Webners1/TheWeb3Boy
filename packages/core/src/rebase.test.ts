import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { rebaseSeries } from './rebase.js';

const entity = [
  { asOf: '2026-01-01', value: '1.0' },
  { asOf: '2026-01-02', value: '1.1' },
  { asOf: '2026-01-03', value: '1.21' },
];

const btc = [
  { symbol: 'BTC', asOf: '2026-01-01', value: '100000' },
  { symbol: 'BTC', asOf: '2026-01-02', value: '110000' },
  { symbol: 'BTC', asOf: '2026-01-03', value: '105000' },
];

describe('rebaseSeries', () => {
  it('puts every leg on the same base', () => {
    const result = rebaseSeries({ entity, benchmarks: btc });
    expect(result.entity[0]?.value).toBe('100');
    // 100 less the 10bp entry cost the benchmark pays to get in.
    expect(result.benchmarks.BTC?.[0]?.value).toBe('99.9');
  });

  it('charges the benchmark the same entry cost benchmarkTwr does', () => {
    const result = rebaseSeries({ entity, benchmarks: btc });
    // 105000/100000 * 0.999 * 100
    expect(result.benchmarks.BTC?.at(-1)?.value).toBe('104.895');
  });

  it('starts on the latest first date, not each leg’s own first date', () => {
    // A vault that launched a day late must not be credited with the
    // benchmark's first-day move, in either direction.
    const late = [
      { asOf: '2026-01-02', value: '1.1' },
      { asOf: '2026-01-03', value: '1.21' },
    ];
    const result = rebaseSeries({ entity: late, benchmarks: btc });

    expect(result.startAsOf).toBe('2026-01-02');
    expect(result.entity[0]?.value).toBe('100');
    expect(result.entity).toHaveLength(2);
    // Rebased from 110000, so BTC is down over the shared window even though
    // it rose over its own full series.
    // 105000/110000 * 0.999 * 100
    expect(result.benchmarks.BTC?.at(-1)?.value).toBe('95.359091');
  });

  it('ends on the earliest last date, so no leg runs past the others', () => {
    const short = [
      { symbol: 'BTC', asOf: '2026-01-01', value: '100000' },
      { symbol: 'BTC', asOf: '2026-01-02', value: '110000' },
    ];
    const result = rebaseSeries({ entity, benchmarks: short });
    expect(result.endAsOf).toBe('2026-01-02');
    expect(result.entity).toHaveLength(2);
  });

  it('drops a benchmark it has no data for rather than inventing a flat line', () => {
    const result = rebaseSeries({ entity, benchmarks: [] });
    expect(result.benchmarks).toEqual({});
    expect(result.entity[0]?.value).toBe('100');
  });

  it('returns nothing when the legs do not overlap', () => {
    const disjoint = [{ symbol: 'BTC', asOf: '2025-01-01', value: '50000' }];
    const result = rebaseSeries({ entity, benchmarks: disjoint });
    expect(result.startAsOf).toBeNull();
    expect(result.entity).toEqual([]);
  });

  it('refuses a zero base instead of dividing by it', () => {
    const zeroed = [
      { asOf: '2026-01-01', value: '0' },
      { asOf: '2026-01-02', value: '1.1' },
    ];
    expect(rebaseSeries({ entity: zeroed, benchmarks: [] }).entity).toEqual([]);
  });

  it('takes an explicit swap cost', () => {
    const result = rebaseSeries(
      { entity, benchmarks: btc },
      { swapCostBps: new Decimal(0) },
    );
    expect(result.benchmarks.BTC?.[0]?.value).toBe('100');
  });

  it('sorts unordered input rather than trusting the caller', () => {
    const shuffled = [entity[2]!, entity[0]!, entity[1]!];
    const result = rebaseSeries({ entity: shuffled, benchmarks: [] });
    expect(result.entity.map((point) => point.asOf)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });
});

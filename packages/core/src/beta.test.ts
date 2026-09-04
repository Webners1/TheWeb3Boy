import { Decimal } from '@vaultbench/shared/decimal';
import { describe, expect, it } from 'vitest';

import { beta } from './beta.js';
import type { BenchmarkClose, NavPoint } from './types.js';

function nav(asOf: string, value: string, sampling: 'daily' | 'downsampled' = 'daily'): NavPoint {
  return {
    asOf,
    valuePerUnit: new Decimal(value),
    method: 'reported',
    navQuality: 'reported',
    sampling,
  };
}

function close(asOf: string, value: string): BenchmarkClose {
  return { asOf, closeUsd: new Decimal(value) };
}

/** A benchmark rising and falling irregularly, so variance is real. */
const BENCH_PATH = ['100', '104', '101', '108', '112', '106', '115', '119'];
const BENCH: BenchmarkClose[] = BENCH_PATH.map((value, index) =>
  close(`2026-01-0${index + 1}`, value),
);

/** Entity moving exactly `gearing` times the benchmark's daily return. */
function gearedEntity(gearing: string): NavPoint[] {
  const factor = new Decimal(gearing);
  const points: NavPoint[] = [nav('2026-01-01', '100')];
  let value = new Decimal('100');
  for (let index = 1; index < BENCH_PATH.length; index += 1) {
    const start = new Decimal(BENCH_PATH[index - 1] ?? '0');
    const end = new Decimal(BENCH_PATH[index] ?? '0');
    const benchReturn = end.div(start).minus(1);
    value = value.times(new Decimal(1).plus(benchReturn.times(factor)));
    points.push(nav(`2026-01-0${index + 1}`, value.toFixed()));
  }
  return points;
}

describe('beta', () => {
  it('reads 1 for an entity that simply tracks the benchmark', () => {
    const result = beta(gearedEntity('1'), BENCH);
    expect(result?.beta.toDP(6).toFixed()).toBe('1');
    expect(result?.rSquared.toDP(6).toFixed()).toBe('1');
    expect(result?.observations).toBe(7);
  });

  it('reads 3 for a 3x leveraged long, which is the whole point', () => {
    // The "Ethereum Bull 3X" case. Its alpha over ETH was 174 points and
    // meaningless; beta says why in one number.
    const result = beta(gearedEntity('3'), BENCH);
    expect(result?.beta.toDP(4).toFixed()).toBe('3');
    // Near-perfect fit: this is gearing, not coincidence.
    expect(result?.rSquared.toDP(4).toFixed()).toBe('1');
  });

  it('reads negative for a short', () => {
    const result = beta(gearedEntity('-2'), BENCH);
    expect(result?.beta.toDP(4).toFixed()).toBe('-2');
  });

  it('reads 0 for a flat, market-neutral entity', () => {
    // Losing to BTC in a bull run is not underperformance for this kind of
    // vault, and a beta of 0 is what says so.
    const flat = BENCH.map((point) => nav(point.asOf, '100'));
    const result = beta(flat, BENCH);
    expect(result?.beta.toFixed()).toBe('0');
    expect(result?.rSquared.toFixed()).toBe('0');
  });

  it('pairs returns over identical intervals, not by position', () => {
    /**
     * The failure this guards against. A downsampled entity series is
     * observed every two days; the benchmark closes daily. Pairing by
     * position would regress 2-day entity returns against 1-day benchmark
     * returns — a step against half a step — and get it wrong silently.
     *
     * Here the entity is 2x geared and sampled on alternate days, so correct
     * date pairing must recover roughly 2 from 2-day intervals on both legs.
     */
    const twoX = gearedEntity('2');
    const everyOtherDay = twoX.filter((_, index) => index % 2 === 0);
    expect(everyOtherDay).toHaveLength(4);

    const result = beta(
      everyOtherDay.map((point) => ({ ...point, sampling: 'downsampled' as const })),
      BENCH,
    );
    expect(result?.observations).toBe(3);

    /**
     * Near 2 but deliberately not asserted as exactly 2, because it is not.
     *
     * The entity is rebalanced to 2x *daily*, and two geared daily steps do
     * not compose into one geared two-day step: +4% then -2.88% is 2x'd to
     * +8% then -5.77%, and compounding those is not twice the compounded
     * benchmark. That convexity is real — it is the same effect that makes
     * leveraged ETFs decay in choppy markets — so measuring beta on a
     * downsampled series returns the gearing only approximately. Observed
     * here as 2.1065, about 5% above the stated 2x.
     *
     * Which means beta on a `downsampled` entity is an estimate, and the
     * sampling label has to travel with it exactly as it does for volatility
     * and drawdown. Recorded as a caveat on the metric.
     */
    expect(result?.beta.gt('2')).toBe(true);
    expect(result?.beta.lt('2.2')).toBe(true);
  });

  it('drops an interval whose benchmark endpoint is missing', () => {
    const withGap = BENCH.filter((point) => point.asOf !== '2026-01-04');
    const result = beta(gearedEntity('2'), withGap);
    // The two intervals touching 01-04 are unusable, leaving five.
    expect(result?.observations).toBe(5);
    expect(result?.beta.toDP(4).toFixed()).toBe('2');
  });

  it('refuses a figure that would not mean anything', () => {
    // One interval fits any slope perfectly.
    expect(beta([nav('2026-01-01', '100'), nav('2026-01-02', '110')], BENCH)).toBeUndefined();

    // A benchmark that never moved has no slope to measure against, and a
    // zero denominator is not a beta of zero.
    const motionless = BENCH.map((point) => close(point.asOf, '100'));
    expect(beta(gearedEntity('2'), motionless)).toBeUndefined();

    // No shared dates at all.
    const elsewhere = BENCH.map((point) => close(point.asOf.replace('2026', '2025'), '100'));
    expect(beta(gearedEntity('2'), elsewhere)).toBeUndefined();
  });

  it('reports a low r-squared when the relationship is noise', () => {
    // Beta is computable here but must not be read as gearing. Publishing it
    // without r-squared would invite exactly that.
    const noisy = [
      nav('2026-01-01', '100'),
      nav('2026-01-02', '90'),
      nav('2026-01-03', '130'),
      nav('2026-01-04', '95'),
      nav('2026-01-05', '140'),
      nav('2026-01-06', '85'),
      nav('2026-01-07', '150'),
      nav('2026-01-08', '80'),
    ];
    const result = beta(noisy, BENCH);
    expect(result).toBeDefined();
    expect(result?.rSquared.lt('0.5')).toBe(true);
  });

  it('separates a leveraged tracker from a genuine outperformer', () => {
    /**
     * The decision beta exists to enable. Both entities below end the window
     * far ahead of the benchmark, so both report large positive alpha and
     * would sort adjacently on any alpha-ranked list. Only one of them did
     * anything.
     */
    const levered = gearedEntity('3');

    // Same total gain, earned by steady accrual unrelated to the benchmark.
    const skilled: NavPoint[] = BENCH.map((point, index) =>
      nav(point.asOf, new Decimal('100').times(new Decimal('1.05').pow(index)).toFixed()),
    );

    const leveredBeta = beta(levered, BENCH);
    const skilledBeta = beta(skilled, BENCH);

    // The leveraged vault is three times the benchmark and explained by it.
    expect(leveredBeta?.beta.toDP(2).toFixed()).toBe('3');
    expect(leveredBeta?.rSquared.gt('0.9')).toBe(true);

    // The steady earner has effectively no benchmark exposure to explain it.
    expect(skilledBeta?.beta.abs().lt('0.1')).toBe(true);
    expect(skilledBeta?.rSquared.lt('0.1')).toBe(true);
  });

  it('never lets r-squared leave the 0..1 range', () => {
    for (const gearing of ['0.5', '1', '2', '-3']) {
      const result = beta(gearedEntity(gearing), BENCH);
      expect(result?.rSquared.gte(0)).toBe(true);
      expect(result?.rSquared.lte(1)).toBe(true);
    }
  });
});

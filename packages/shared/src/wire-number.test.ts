import { describe, expect, it } from 'vitest';

import { wireNumberDecimalString } from './wire-number.js';

describe('wireNumberDecimalString', () => {
  it('preserves every digit a real Enzyme response carried', () => {
    // Captured live from GetVaultTimeSeries. Seventeen significant digits,
    // and none of them ours to discard.
    const observed = [
      1688.2824302978102, 1724.2856506965004, 1702.477285584056, 1711.6295885615227,
      25915687.10653366, 15348.346314223398, 2246.9706589468947,
    ];
    for (const value of observed) {
      expect(wireNumberDecimalString(value)).toBe(String(value));
    }
  });

  it('does not round to float32 precision, which would destroy real digits', () => {
    // The regression this module was rewritten for. Enzyme's protobuf declares
    // these fields `float`, so the first implementation snapped to the nearest
    // float32 and returned "1688.2825". The live API is not float32 at all:
    // no observed value is even representable as one.
    const value = 1688.2824302978102;
    expect(Math.fround(value)).not.toBe(value);
    expect(wireNumberDecimalString(value)).toBe('1688.2824302978102');
  });

  it('adds no digits to a value that had few', () => {
    expect(wireNumberDecimalString(1.05)).toBe('1.05');
    expect(wireNumberDecimalString(1)).toBe('1');
    expect(wireNumberDecimalString(0.5)).toBe('0.5');
    expect(wireNumberDecimalString(100)).toBe('100');
  });

  it('never returns exponential notation, which numeric cannot take', () => {
    // Enzyme sends these: assetPercentages had a 7.098527007548042e-23.
    for (const value of [7.098527007548042e-23, 1e-7, 1e21, 3.4e38]) {
      const text = wireNumberDecimalString(value);
      expect(text).not.toMatch(/[eE]/);
      expect(text).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it('round-trips back to the same double', () => {
    for (const value of [1688.2824302978102, 7.098527007548042e-23, 1e21, -1.05, 0]) {
      expect(Number(wireNumberDecimalString(value))).toBe(value);
    }
  });

  it('keeps the sign and handles zero without padding it out', () => {
    expect(wireNumberDecimalString(0)).toBe('0');
    expect(wireNumberDecimalString(-0)).toBe('0');
    expect(wireNumberDecimalString(-1.05)).toBe('-1.05');
  });

  it('refuses a non-finite value rather than coercing it to zero', () => {
    // A venue sending NaN is reporting a broken figure. Turning that into 0
    // would turn "we don't know" into "it is worthless".
    expect(() => wireNumberDecimalString(Number.NaN)).toThrow(/not finite/);
    expect(() => wireNumberDecimalString(Number.POSITIVE_INFINITY)).toThrow(/not finite/);
    expect(() => wireNumberDecimalString(Number.NEGATIVE_INFINITY)).toThrow(/not finite/);
  });
});

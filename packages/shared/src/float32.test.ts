import { describe, expect, it } from 'vitest';

import { float32DecimalString } from './float32.js';

describe('float32DecimalString', () => {
  it('does not invent the digits a double adds to a float', () => {
    // The float32 nearest 1.05, widened to a double, prints as
    // 1.0499999523162842. Sixteen digits from a seven-digit source, and the
    // tail is noise that would render as precision.
    const asDouble = Math.fround(1.05);
    expect(String(asDouble)).toContain('1.04999995');

    expect(float32DecimalString(asDouble)).toBe('1.05');
  });

  it('round-trips every value it returns back to the same float32', () => {
    const values = [
      1, 1.05, 0.5, 123.456, 1e-7, 2.5e-8, 1234567, 12345678.9, 1e9, 3.4e38, 1.175e-38,
      0.1, 0.2, 0.3, 99.99, 1.0000001,
    ];
    for (const value of values) {
      const single = Math.fround(value);
      const text = float32DecimalString(single);
      expect(Math.fround(Number(text))).toBe(single);
    }
  });

  it('never returns exponential notation, which numeric cannot take', () => {
    for (const value of [1e-7, 2.5e-8, 1e9, 3.4e38, 1.175e-38]) {
      const text = float32DecimalString(Math.fround(value));
      expect(text).not.toMatch(/[eE]/);
      // Still a decimal string the rest of the pipeline will accept.
      expect(text).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it('keeps the sign and handles zero without padding it out', () => {
    expect(float32DecimalString(0)).toBe('0');
    expect(float32DecimalString(-0)).toBe('0');
    expect(float32DecimalString(Math.fround(-1.05))).toBe('-1.05');
  });

  it('refuses a non-finite value rather than coercing it to zero', () => {
    // A venue sending NaN is reporting a broken figure. Turning that into 0
    // would turn "we don't know" into "it is zero", which is a lie that
    // compounds through a return series.
    expect(() => float32DecimalString(Number.NaN)).toThrow(/not finite/);
    expect(() => float32DecimalString(Number.POSITIVE_INFINITY)).toThrow(/not finite/);
    expect(() => float32DecimalString(Number.NEGATIVE_INFINITY)).toThrow(/not finite/);
  });

  it('stays shortest, not merely correct', () => {
    // A correct-but-lazy implementation could return toPrecision(9) for
    // everything and still round-trip. That would publish "1.05000000" and
    // claim nine digits of a seven-digit source.
    expect(float32DecimalString(Math.fround(1))).toBe('1');
    expect(float32DecimalString(Math.fround(0.5))).toBe('0.5');
    expect(float32DecimalString(Math.fround(100))).toBe('100');
  });
});

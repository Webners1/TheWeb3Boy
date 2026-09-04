import { describe, expect, it } from 'vitest';

import { parseDecimal, toNumericString } from './decimal.js';
import { decimalString } from './zod.js';

describe('parseDecimal', () => {
  it('preserves full precision on high-precision money strings', () => {
    expect(toNumericString(parseDecimal('329265410.90790099'))).toBe('329265410.90790099');
  });

  it('does not exhibit float error', () => {
    const sum = parseDecimal('0.1').plus(parseDecimal('0.2'));
    expect(toNumericString(sum)).toBe('0.3');
  });

  it('rejects non-finite input', () => {
    expect(() => parseDecimal('Infinity')).toThrow(RangeError);
  });
});

describe('decimalString', () => {
  it('accepts and canonicalises a decimal string', () => {
    expect(decimalString.parse('1.5')).toBe('1.5');
  });

  it('rejects garbage', () => {
    expect(decimalString.safeParse('not-a-number').success).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(decimalString.safeParse('NaN').success).toBe(false);
    expect(decimalString.safeParse('Infinity').success).toBe(false);
  });
});

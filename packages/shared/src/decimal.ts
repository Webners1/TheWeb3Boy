import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40 });

export { Decimal };

/**
 * Parse an external decimal string. The only accepted entry point for money
 * values — a `parseFloat`/`Number()` on a money value is a defect (AGENTS.md).
 */
export function parseDecimal(raw: string): Decimal {
  const value = new Decimal(raw);
  if (!value.isFinite()) {
    throw new RangeError(`non-finite decimal: ${raw}`);
  }
  return value;
}

/**
 * Canonical fixed-point string for a Postgres `numeric` column.
 * Never exponential notation, never a float.
 */
export function toNumericString(value: Decimal): string {
  return value.toFixed();
}

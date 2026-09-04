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
 *
 * Pass `scale` to match a column definition (e.g. 8 for `numeric(28,8)`).
 */
export function toNumericString(value: Decimal, scale?: number): string {
  return scale === undefined ? value.toFixed() : value.toFixed(scale);
}

/**
 * Convert a JSON number (already IEEE-parsed by JSON.parse) into Decimal.
 * DefiLlama prices and Hyperliquid fee fields arrive this way. This is not
 * parseFloat — the number already exists; we only box it.
 */
export function decimalFromJsonNumber(value: number): Decimal {
  if (!Number.isFinite(value)) {
    throw new RangeError(`non-finite JSON number: ${value}`);
  }
  return new Decimal(value);
}

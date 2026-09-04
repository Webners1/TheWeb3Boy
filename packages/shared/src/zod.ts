import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Exact decimal string — the only accepted wire representation of a money
 * value. Output is the canonical fixed-point form ready for Postgres numeric.
 */
export const decimalString = z
  .string()
  .refine(
    (raw) => {
      try {
        return new Decimal(raw).isFinite();
      } catch {
        return false;
      }
    },
    { message: 'must be a finite decimal string' },
  )
  .transform((raw) => new Decimal(raw).toFixed());

/**
 * Money field that may arrive as a decimal string (Hyperliquid equity) or a
 * JSON number (Hyperliquid fees, DefiLlama prices). Always emits a canonical
 * decimal string.
 */
export const wireDecimal = z.union([
  decimalString,
  z
    .number()
    .finite()
    .transform((value) => new Decimal(value).toFixed()),
]);

export const nonNegativeDecimalString = decimalString.refine((canonical) =>
  new Decimal(canonical).gte(0),
);

/** Lowercase 0x-prefixed hex address (Hyperliquid vaults/leaders). */
export const hexAddress = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x hex address'));

/** Millisecond epoch timestamp, as returned by Hyperliquid (JSON number). */
export const epochMillis = z.number().int().nonnegative();

/** OKX often sends millisecond timestamps as strings; open positions use "". */
export const epochMillisWire = z.union([
  epochMillis,
  z
    .string()
    .regex(/^[0-9]+$/)
    .transform((raw) => Number.parseInt(raw, 10)),
]);

export const optionalEpochMillisWire = z.preprocess(
  (value) => (value === '' ? undefined : value),
  epochMillisWire.optional(),
);

/** Calendar date YYYY-MM-DD. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

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

export const nonNegativeDecimalString = decimalString.refine((canonical) =>
  new Decimal(canonical).gte(0),
);

/** Lowercase 0x-prefixed hex address (Hyperliquid vaults/leaders/depositors). */
export const hexAddress = z.string().regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x hex address');

/** Millisecond epoch timestamp, as returned by Hyperliquid. */
export const epochMillis = z.number().int().nonnegative();

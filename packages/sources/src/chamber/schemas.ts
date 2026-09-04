import { z } from 'zod';
import { decimalString, epochMillisWire, hexAddress } from '@vaultbench/shared';

/**
 * Chamber (formerly dHEDGE) hosted Data API — a public, no-auth GraphQL
 * endpoint. Documented at https://docs.chamberfi.com/build/data-api.
 *
 * Two scaling conventions coexist in this one API and mixing them up is a
 * factor of 1e18:
 *   - `Fund.totalValue`, `Fund.totalSupply`, `Fund.tokenPrice` are wei-scale
 *     integer strings with 18 decimals.
 *   - `WrappedTokenPrice.adjustedTokenPrice` in the history is *already*
 *     decimal-scaled ("1.472249677945493335").
 * See docs/traps.md.
 */

/** Fee numerators are basis points over a denominator of 10,000. */
const feeNumerator = z
  .string()
  .regex(/^[0-9]+$/, 'fee numerator must be an unsigned integer string')
  // A numerator above the denominator would mean a fee over 100%, which is
  // not a fee — it is our assumption about the denominator being wrong. Fail
  // loudly here rather than publish a 200% management fee.
  .refine((raw) => Number.parseInt(raw, 10) <= 10_000, {
    message: 'fee numerator exceeds the 10,000 basis-point denominator',
  });

export const chamberFundSchema = z.object({
  address: hexAddress,
  name: z.string(),
  symbol: z.string().nullable().optional(),
  managerName: z.string().nullable().optional(),
  managerAddress: hexAddress.nullable().optional(),
  managerLogicAddress: z.string().nullable().optional(),
  blockchainCode: z.string(),
  poolType: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  isPrivate: z.boolean().nullable().optional(),
  // Wei-scale, 18 decimals.
  totalValue: decimalString,
  totalSupply: decimalString.nullable().optional(),
  tokenPrice: decimalString.nullable().optional(),
  /** Vault creation time, in *seconds*. */
  blockTime: z
    .string()
    .regex(/^[0-9]+$/)
    .nullable()
    .optional(),
  performanceFeeNumerator: feeNumerator.nullable().optional(),
  managerFeeNumerator: feeNumerator.nullable().optional(),
  streamingFeeNumerator: feeNumerator.nullable().optional(),
  entryFeeNumerator: feeNumerator.nullable().optional(),
  exitFeeNumerator: feeNumerator.nullable().optional(),
});

export const chamberAllFundsSchema = z.object({
  data: z.object({
    allFundsByBlockchainCode: z.array(chamberFundSchema),
  }),
});

/**
 * A point on `tokenPriceHistory`.
 *
 * **`adjustedTokenPrice` here is not a token price.** Despite the name it is
 * cumulative return since inception, as a fraction: the first point of an
 * `all` series is exactly `"0"`, values go negative when the vault is under
 * water (observed down to `-0.55`), and `1 + lastValue` reconciles with
 * `Fund.tokenPrice`. A share price cannot be negative, which is how the
 * mislabelling was caught. Per-unit value is therefore `1 + value`.
 * See docs/traps.md.
 */
export const chamberPricePointSchema = z.object({
  /** Milliseconds, as a string. */
  timestamp: epochMillisWire,
  // Observed null on every point of a real response — the populated field is
  // adjustedTokenPrice. Never assume tokenPrice is present here.
  tokenPrice: decimalString.nullable().optional(),
  adjustedTokenPrice: decimalString.nullable().optional(),
  performance: decimalString.nullable().optional(),
  adjustedPerformance: decimalString.nullable().optional(),
});

export const chamberTokenPriceHistorySchema = z.object({
  data: z.object({
    tokenPriceHistory: z
      .object({
        history: z.array(chamberPricePointSchema),
      })
      .nullable(),
  }),
});

export type ChamberFund = z.infer<typeof chamberFundSchema>;
export type ChamberPricePoint = z.infer<typeof chamberPricePointSchema>;

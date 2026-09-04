import { z } from 'zod';
import { float32DecimalString } from '@vaultbench/shared/float32';
import { hexAddress } from '@vaultbench/shared';

/**
 * Enzyme API — a gRPC/Connect service at https://api.enzyme.finance, spoken
 * over plain HTTP POST with JSON bodies. Requires a free self-serve bearer
 * token from https://app.enzyme.finance/account/api-tokens.
 *
 * These schemas are transcribed from the protobuf definitions published openly
 * on the Buf Schema Registry (`buf export buf.build/avantgardefinance/enzyme`),
 * so the response *shape* is checked against the vendor's own contract rather
 * than guessed. What a schema cannot tell you — units, and whether a figure is
 * gross or net — is called out where it matters below.
 *
 * Three properties of this encoding will bite anyone who assumes ordinary
 * JSON. Each is handled once, here, rather than in the adapter.
 */

/**
 * 1. Every numeric field in the Enzyme schema is a protobuf `float`: 32-bit,
 *    roughly 7.2 significant decimal digits. Share prices, asset values and
 *    fee rates all arrive that way, already lossy.
 *
 *    Parsing one straight into a `Decimal` through JavaScript's double would
 *    append about nine digits of noise — the float32 nearest 1.05 prints as
 *    1.0499999523162842 — and a `numeric` column would then assert precision
 *    the venue never had. `float32DecimalString` returns the shortest string
 *    that round-trips to the same float32, carrying the source's real
 *    precision and not one digit more. See its module doc and docs/traps.md.
 */
const float32Decimal = z.number().transform((value, ctx) => {
  try {
    return float32DecimalString(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'unreadable float32',
    });
    return z.NEVER;
  }
});

/**
 * 2. Connect's JSON encoding omits zero-valued fields by default, so an absent
 *    number means 0 and an absent boolean means `false` — not "missing".
 *
 *    The direction of that default is load-bearing for `priceIsValid`: absent
 *    must read as `false`, because treating an unspoken validity flag as
 *    `true` waves through exactly the prices Enzyme is warning us about.
 */
const maybeFloat32 = float32Decimal.nullish();

/**
 * 3. `google.protobuf.Timestamp` is an RFC 3339 string in Connect JSON
 *    ("2026-01-02T15:04:05Z") — not epoch millis like Chamber, and not epoch
 *    seconds like Hyperliquid. Three venues, three time encodings.
 */
const protoTimestamp = z.string().refine((raw) => !Number.isNaN(Date.parse(raw)), {
  message: 'expected an RFC 3339 timestamp',
});

/**
 * Enzyme emits lowerCamelCase JSON by default, but a Connect server configured
 * with `UseProtoNames` emits the snake_case field names instead, and both are
 * valid protojson for the same field. Which one this deployment uses cannot be
 * observed without a token, so both are accepted — normalised to camelCase
 * once, here, so no downstream schema has to know.
 *
 * This is not the silent-fallback trap that Chamber's chain codes were. There,
 * an unrecognised input was quietly mapped to a different, *wrong* value. Here
 * the two spellings are the same field by the vendor's own spec, nothing is
 * invented, and a third spelling still fails.
 */
function camelCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelCaseKeys);
  if (typeof value !== 'object' || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const camel = key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
    out[camel] = camelCaseKeys(nested);
  }
  return out;
}

/** Applies the casing fix, then the real schema. */
function connectJson<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(camelCaseKeys, schema);
}

/** One point of `GetVaultTimeSeries`. */
export const enzymeTimeSeriesItemSchema = z.object({
  timestamp: protoTimestamp,
  /**
   * Per-unit value, net of fees. The protobuf comment reads "the net share
   * value at the timestamp" and Enzyme's own UI charts it as share price, so
   * this is a genuine reported NAV per share. That is why Enzyme can claim
   * `navQuality: 'reported'` where OKX, which publishes only account value
   * and PnL, cannot.
   */
  netShareValue: maybeFloat32,
  /** Total value of assets held, before fees. Not per-unit. */
  grossAssetValue: maybeFloat32,
  numberOfShares: maybeFloat32,
  /**
   * Enzyme's own admission that it could not price the vault's holdings at
   * this timestamp — a stale or missing oracle feed, usually. The share value
   * is still populated, and is still wrong.
   */
  priceIsValid: z.boolean().nullish(),
});

export const enzymeTimeSeriesResponseSchema = connectJson(
  z.object({
    items: z.array(enzymeTimeSeriesItemSchema).nullish(),
  }),
);

/** One entry of `GetVaultList`. */
export const enzymeVaultListItemSchema = z.object({
  address: hexAddress,
  inception: protoTimestamp.nullish(),
  sharePrice: maybeFloat32,
  /** Same warning as `priceIsValid`, applied to the current price. */
  sharePriceValid: z.boolean().nullish(),
  grossAssetValue: maybeFloat32,
  numberOfShares: maybeFloat32,
  numberOfDepositors: maybeFloat32,
});

export const enzymeVaultListResponseSchema = connectJson(
  z.object({
    numberOfVaults: z.number().int().nullish(),
    vaults: z.array(enzymeVaultListItemSchema).nullish(),
  }),
);

/** `GetVault` — per-vault detail, used for names and metadata. */
export const enzymeVaultResponseSchema = connectJson(
  z.object({
    address: hexAddress,
    name: z.string().nullish(),
    symbol: z.string().nullish(),
    owner: z.string().nullish(),
    inception: protoTimestamp.nullish(),
    denomination: z.string().nullish(),
    sharePrice: maybeFloat32,
    netAssetValue: maybeFloat32,
    grossAssetValue: maybeFloat32,
    numberOfShares: maybeFloat32,
  }),
);

export type EnzymeVaultListItem = z.infer<typeof enzymeVaultListItemSchema>;
export type EnzymeTimeSeriesItem = z.infer<typeof enzymeTimeSeriesItemSchema>;
export type EnzymeVault = z.infer<typeof enzymeVaultResponseSchema>;

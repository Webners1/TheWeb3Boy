import { z } from 'zod';
import { wireNumberDecimalString } from '@vaultbench/shared/wire-number';
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
 * 1. Money arrives as bare JSON numbers, not decimal strings, so every value
 *    has been through a binary float before we can touch it.
 *
 *    The schema declares these fields `float` (32-bit), and taking that at
 *    face value was a mistake: a live `netShareValue` is
 *    `1688.2824302978102`, which is not float32-representable at all — the
 *    nearest float32 is `1688.282470703125`. Rounding to float32 precision, as
 *    an earlier version of this file did, would have published `"1688.2825"`
 *    and thrown away nine real digits. The `float` describes the gRPC binary
 *    encoding, not what the JSON gateway emits.
 *
 *    `wireNumberDecimalString` preserves the wire token exactly — no digits
 *    added, none dropped. See its module doc and trap 19.
 */
const wireDecimal = z.number().transform((value, ctx) => {
  try {
    return wireNumberDecimalString(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'unreadable wire number',
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
const maybeDecimal = wireDecimal.nullish();

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
  netShareValue: maybeDecimal,
  /** Total value of assets held, before fees. Not per-unit. */
  grossAssetValue: maybeDecimal,
  numberOfShares: maybeDecimal,
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
  sharePrice: maybeDecimal,
  /** Same warning as `priceIsValid`, applied to the current price. */
  sharePriceValid: z.boolean().nullish(),
  grossAssetValue: maybeDecimal,
  numberOfShares: maybeDecimal,
  numberOfDepositors: maybeDecimal,
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
    sharePrice: maybeDecimal,
    netAssetValue: maybeDecimal,
    grossAssetValue: maybeDecimal,
    numberOfShares: maybeDecimal,
  }),
);

export type EnzymeVaultListItem = z.infer<typeof enzymeVaultListItemSchema>;
export type EnzymeTimeSeriesItem = z.infer<typeof enzymeTimeSeriesItemSchema>;
export type EnzymeVault = z.infer<typeof enzymeVaultResponseSchema>;

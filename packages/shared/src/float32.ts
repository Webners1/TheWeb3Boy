/**
 * Reading a source that publishes 32-bit floats, without fabricating digits.
 *
 * This module exists for exactly one reason: the Enzyme API's protobuf schema
 * declares every numeric field as `float` — IEEE-754 single precision, about
 * 7.2 significant decimal digits. `net_share_value`, `gross_asset_value` and
 * every fee `rate` come off the wire that way. Check it for yourself with
 * `buf export buf.build/avantgardefinance/enzyme -o <dir>`, which needs no
 * credentials; the finding is also recorded in docs/traps.md.
 *
 * That is a fact about the venue, not a bug we can fix. The repository rule is
 * "no floating point anywhere in the data path", and the rule still holds: the
 * job here is to get off the float immediately, at the boundary, and to carry
 * forward *only* the precision the source actually had.
 *
 * The trap is not the lost precision. It is the precision that gets invented
 * on the way in. A JSON number is parsed by JavaScript into a double, and the
 * float32 nearest to 1.05 printed as a double is `1.0499999523162842`. Store
 * that in a `numeric` column and the database now asserts sixteen significant
 * digits about a number that was only ever good for seven. Nine of those
 * digits are noise, and they will show up in a rendered figure looking exactly
 * like precision.
 *
 * So: return the *shortest* decimal string that still round-trips to the same
 * float32. For the case above that is `"1.05"` — no invented digits, and no
 * loss beyond what the source already imposed. This is the same shortest
 * round-trip rule Go's `protojson` uses when it serialises a float32, so in
 * practice this reconstructs the exact token the server put on the wire.
 *
 * Nothing outside `packages/sources/src/enzyme/` may import this module. The
 * `float32-quarantine` rule in `tools/check-harness.mjs` enforces that, so the
 * concession stays attached to the one venue that forces it instead of
 * becoming a general-purpose escape hatch from the decimal rule.
 */

import { Decimal } from './decimal.js';

/**
 * A float32 is guaranteed to survive a decimal round-trip at 9 significant
 * digits, and never needs more than that. Used as the loop ceiling and as the
 * last-resort precision.
 */
const FLOAT32_MAX_SIGNIFICANT_DIGITS = 9;

/**
 * The shortest decimal string that round-trips to the same 32-bit float.
 *
 * @param value A JSON number that originated as a protobuf `float`.
 * @returns A plain (never exponential) decimal string, safe to hand to
 *   `parseDecimal` or a `numeric` column.
 * @throws If the value is not finite. `NaN` and `Infinity` are not quantities;
 *   a venue that sends one is reporting a broken figure, and coercing it to 0
 *   would turn "we don't know" into "it is zero".
 */
export function float32DecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`float32 value is not finite: ${value}`);
  }

  // Snap to the float32 the source actually held. A double that has been
  // through JSON is already exactly that value, but being explicit means the
  // round-trip test below is comparing like with like.
  const single = Math.fround(value);

  // Zero has no significant digits to search for, and `toPrecision` would
  // hand back "0.00000000".
  if (single === 0) return '0';

  for (let digits = 1; digits <= FLOAT32_MAX_SIGNIFICANT_DIGITS; digits += 1) {
    const candidate = single.toPrecision(digits);
    // The shortest candidate that lands back on the same float32 carries
    // every digit the source had and not one more.
    if (Math.fround(Number(candidate)) === single) {
      return plainDecimal(candidate);
    }
  }

  return plainDecimal(single.toPrecision(FLOAT32_MAX_SIGNIFICANT_DIGITS));
}

/**
 * `toPrecision` switches to exponential notation outside a middling range
 * ("1.05e+7", "1.2e-7"), and neither a `numeric` column nor a chart axis wants
 * that. Decimal.js does the expansion exactly, without going back through a
 * float.
 */
function plainDecimal(value: string): string {
  return new Decimal(value).toFixed();
}

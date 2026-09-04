/**
 * Reading a venue that sends JSON numbers instead of decimal strings, without
 * adding or removing a single digit.
 *
 * Most sources here send money as strings, which is the right thing to do and
 * needs no help. Enzyme's Connect/JSON API sends bare JSON numbers, so the
 * value has already been through a binary float by the time we can touch it.
 * The repository rule is "no floating point anywhere in the data path", and it
 * still holds: the job is to get off the float at the boundary and carry
 * forward *exactly* what the wire said.
 *
 * The rule is preserve, not round. Both directions are ways to lie:
 *
 * - **Adding digits.** A value that only ever had 7 significant digits, wid‑
 *   ened to a double and printed, gains a tail of noise that renders as
 *   precision.
 * - **Dropping digits.** A value that genuinely carried 17 significant digits,
 *   rounded to some assumed precision, silently loses real information.
 *
 * JavaScript's `Number`-to-string conversion is the shortest decimal that
 * round-trips to the same double, which is also what Go's `strconv` produces
 * when a server serialises one. So `String(value)` reproduces the wire token
 * and is the whole trick. Everything else in this module is expanding
 * exponential notation so a `numeric` column will take it.
 *
 * ## Why this is not float32-aware
 *
 * Enzyme's published protobuf declares every numeric field as `float` — 32-bit,
 * about 7.2 significant digits. Taking that at face value, the first version of
 * this module snapped each value to the nearest float32 and returned the
 * shortest string that round-tripped to it, on the theory that anything longer
 * was invented precision.
 *
 * The live API disproved it. Not one observed value is float32-representable:
 * `netShareValue` arrives as `1688.2824302978102`, whose nearest float32 is
 * `1688.282470703125`. The float32 treatment would have published
 * `"1688.2825"` and destroyed nine digits of real data. The `float` in the
 * schema describes the gRPC binary encoding, not what the JSON gateway emits.
 *
 * The lesson is worth more than the code: a schema constrains the shape, never
 * the precision actually delivered. Verify precision against a live response.
 * Recorded as trap 19.
 *
 * Nothing outside `packages/sources/src/enzyme/` may import this module — the
 * `json-number-quarantine` rule in `tools/check-harness.mjs` enforces it, so
 * this stays a concession to the one venue that forces it rather than a
 * general escape hatch from asking a venue for a string.
 */

import { Decimal } from './decimal.js';

/**
 * The exact decimal the wire carried, as a plain string.
 *
 * @param value A number straight out of `JSON.parse`.
 * @returns A plain (never exponential) decimal string, safe for `parseDecimal`
 *   or a `numeric` column.
 * @throws If the value is not finite. `NaN` and `Infinity` are not quantities;
 *   a venue that sends one is reporting a broken figure, and coercing it to 0
 *   would turn "we don't know" into "it is zero" and compound that through a
 *   return series.
 */
export function wireNumberDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`wire number is not finite: ${value}`);
  }

  // String(value) is already the shortest round-tripping decimal. Decimal.js
  // only expands exponential notation ("7.1e-23"), which a numeric column and
  // a chart axis both refuse, and it does that expansion exactly rather than
  // going back through a float.
  return new Decimal(String(value)).toFixed();
}

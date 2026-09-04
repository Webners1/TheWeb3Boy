/**
 * Pure UTC date arithmetic on `YYYY-MM-DD` strings. `packages/core` performs
 * no I/O, so it does not reach for the shared date helpers that also expose a
 * clock.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoToUtcMillis(value: string): number {
  const match = ISO_DATE.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`invalid ISO date: ${value}`);
  }
  return Date.UTC(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10) - 1,
    Number.parseInt(match[3], 10),
  );
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function dayDiff(from: string, to: string): number {
  return Math.round((isoToUtcMillis(to) - isoToUtcMillis(from)) / MS_PER_DAY);
}

export function addDaysIso(value: string, days: number): string {
  const shifted = new Date(isoToUtcMillis(value) + days * MS_PER_DAY);
  const year = shifted.getUTCFullYear().toString().padStart(4, '0');
  const month = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = shifted.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

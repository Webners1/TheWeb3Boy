/** UTC calendar helpers. Snapshot `as_of` is always a UTC date. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`invalid ISO date: ${value}`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (toIsoDate(date) !== value) {
    throw new Error(`invalid ISO date: ${value}`);
  }
  return date;
}

export function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function dateFromEpochMillis(millis: number): Date {
  return new Date(millis);
}

export function unixSecondsUtc(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Client for the youVsBTC / VaultBench API.
 *
 * Two rules the API documents and this client preserves:
 *  1. Money is a string. Returns and ratios come back as exact decimal
 *     strings; they are kept as strings on the wire types and only parsed
 *     to a float at the point of display or plotting (see `num`).
 *  2. Coverage travels with every figure. Every metrics object carries a
 *     `coverage` block, and the UI is expected to show it rather than
 *     present a 90-day number built from 4 days of data as a 90-day number.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_VAULTBENCH_URL?.replace(/\/$/, "") ||
  "https://api-production-e1b0.up.railway.app";

export type Coverage = {
  windowDays: number;
  daysCovered: number;
  isFullWindow: boolean;
  sampling: string;
  navQuality: string;
  headlineEligible: boolean;
  feesApplied: boolean;
};

export type Metrics = {
  asOf: string;
  twr: string | null;
  benchTwrBtc: string | null;
  benchTwrEth: string | null;
  benchTwrSol: string | null;
  alphaBtc: string | null;
  alphaEth: string | null;
  alphaSol: string | null;
  betaBtc: string | null;
  betaEth: string | null;
  betaSol: string | null;
  rSquaredBtc: string | null;
  rSquaredEth: string | null;
  rSquaredSol: string | null;
  maxDrawdown: string | null;
  volatility: string | null;
  followerMedianReturn: string | null;
  followerGap: string | null;
  coverage: Coverage;
} | null;

export type Entity = {
  id: string;
  source: string;
  externalId: string;
  kind: string;
  name: string;
  venue: string;
  venueType: string;
  marketType: string | null;
  strategyCategory: string | null;
  baseCurrency: string;
  inceptionDate: string | null;
  status: string;
  metrics: Metrics;
};

export type EntitiesResponse = {
  windowDays: number;
  pagination: { limit: number; offset: number; total: number };
  entities: Entity[];
};

export type SeriesPoint = { asOf: string; value: string };

export type CompareResponse = {
  entityId: string;
  startAsOf: string;
  endAsOf: string;
  entity: SeriesPoint[];
  benchmarks: Record<string, SeriesPoint[]>;
  coverage: Coverage;
  note: string;
};

export type MetricDefinition = {
  key: string;
  label: string;
  description: string;
  unit: string;
  direction: string;
  caveats: string;
};

export type DefinitionsResponse = { windows: number[]; definitions: MetricDefinition[] };

export const WINDOWS = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 365, label: "1y" },
  { value: 0, label: "All time" },
] as const;

export const SORTS = [
  { value: "alphaBtc", label: "Alpha vs BTC" },
  { value: "twr", label: "Return" },
  { value: "maxDrawdown", label: "Max drawdown" },
  { value: "volatility", label: "Volatility" },
  { value: "name", label: "Name" },
] as const;

export type EntityQuery = {
  window?: number;
  source?: string;
  status?: string;
  sort?: string;
  direction?: "asc" | "desc";
  fullWindow?: boolean;
  headlineEligible?: boolean;
  limit?: number;
  offset?: number;
};

/** The API answers 4xx with { error, detail }; surface that rather than a bare status. */
async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) detail = `${body.error}: ${typeof body.detail === "string" ? body.detail : detail}`;
    } catch {
      /* keep the status-line fallback */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function listEntities(q: EntityQuery = {}) {
  return get<EntitiesResponse>("/entities", {
    window: q.window ?? 90,
    source: q.source,
    status: q.status,
    sort: q.sort ?? "alphaBtc",
    direction: q.direction ?? "desc",
    // Partial records require the API's explicit exploration mode.
    view: q.fullWindow === false ? "explore" : undefined,
    fullWindow: q.fullWindow ? "true" : undefined,
    headlineEligible: q.headlineEligible === undefined ? undefined : String(q.headlineEligible),
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });
}

export function compare(entityId: string, bench = "BTC,ETH,SOL", window = 90) {
  return get<CompareResponse>("/compare", { entity: entityId, bench, window });
}

export function metricDefinitions() {
  return get<DefinitionsResponse>("/metrics/definitions");
}

/** Parse an exact-decimal string for display/plotting only. Never for storage. */
export function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatPct(v: string | null | undefined, digits = 1): string {
  const n = num(v);
  if (n === null) return "—";
  const pct = n * 100;
  // Degenerate vaults in this dataset can carry returns in the billions of
  // percent; abbreviate rather than printing an unreadable wall of digits.
  if (Math.abs(pct) >= 1_000_000) return `${pct < 0 ? "−" : "+"}${(Math.abs(pct) / 1_000_000).toFixed(1)}M%`;
  if (Math.abs(pct) >= 10_000) return `${pct < 0 ? "−" : "+"}${(Math.abs(pct) / 1000).toFixed(1)}k%`;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(digits)}%`;
}

export function formatMoney(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : 2;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/** Enzyme names are raw contract addresses; keep them recognisable but short. */
export function shortName(name: string): string {
  if (/^0x[0-9a-f]{40}$/i.test(name)) return `${name.slice(0, 6)}…${name.slice(-4)}`;
  return name.length > 34 ? `${name.slice(0, 32)}…` : name;
}

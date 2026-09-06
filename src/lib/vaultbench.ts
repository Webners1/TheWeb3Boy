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

export type NavQuality = "reported" | "derived" | "roi";

export type Coverage = {
  windowDays: number;
  daysCovered: number;
  isFullWindow: boolean;
  sampling: string;
  navQuality: NavQuality | null;
  headlineEligible: boolean;
  feesApplied: boolean;
  benchmarks: {
    btc: "ok" | "unavailable";
    eth: "ok" | "unavailable";
    sol: "ok" | "unavailable";
  };
};

export type MetricRow = {
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
};

export type Metrics = MetricRow | null;

export type FeeTerm = {
  status: string;
  value: string | null;
  rawRef: string | null;
  rawFieldPath: string | null;
};

export type FeeCoverage = {
  status: string;
  managementFee: FeeTerm;
  performanceFee: FeeTerm;
  leaderCommission: FeeTerm;
  streamingFee: FeeTerm;
  entryFee: FeeTerm;
  exitFee: FeeTerm;
  redemptionPeriodDays: FeeTerm;
  highWaterMark: FeeTerm;
  note: string | null;
};

export type EntityBase = {
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
  provenance: string;
  copyMode: string | null;
  positionsVisible: boolean | null;
  managerStakeRatio: string | null;
  pendingRedemptionsUsd: string | null;
  aumUsd: string | null;
  aumAsOf: string | null;
  fees: FeeCoverage;
  firstSeenAt: string;
  lastSeenAt: string;
  externalUrl: string | null;
};

export type Entity = EntityBase & { metrics: Metrics };

export type EntityDetail = EntityBase & { metrics: MetricRow[] };

export type EntitiesResponse = {
  windowDays: number;
  pagination: { limit: number; offset: number; total: number };
  entities: Entity[];
};

export type EntitiesSummary = {
  windowDays: number;
  view: "ranking" | "explore";
  total: number;
  withMetrics: number;
  beatBtc: number;
  medianTwr: string | null;
  bestAlphaBtc: string | null;
  bestEntityId: string | null;
  capitalUsd: string | null;
};

export type SeriesPoint = { asOf: string; value: string };

export type NavPoint = {
  asOf: string;
  valuePerUnit: string;
  navQuality: string;
  method: string;
  sampling: string;
};

export type FlowPoint = { asOf: string; netFlowUsd: string | null };

export type SeriesResponse = {
  entityId: string;
  points: NavPoint[];
  flows: FlowPoint[];
};

export type CompareResponse = {
  entityId: string;
  startAsOf: string | null;
  endAsOf: string | null;
  entity: SeriesPoint[];
  benchmarks: Record<string, SeriesPoint[]>;
  coverage: Coverage | null;
  note: string;
};

export type Follower = {
  depositor: string;
  equity: string | null;
  pnl: string | null;
  allTimePnl: string | null;
  daysFollowing: number | null;
  entryTime: string | null;
};

export type FollowersResponse = {
  entityId: string;
  asOf: string | null;
  count: number;
  medianReturn: string | null;
  p25Return: string | null;
  p75Return: string | null;
  followers: Follower[];
  coverage: {
    status: "current" | "stale" | "unavailable";
    lagDays: number | null;
    reasons: string[];
    lastFailure: {
      asOf: string | null;
      endpoint: string | null;
      httpStatus: number | null;
      upstreamCode: string | null;
      upstreamMessage: string | null;
      rawRef: string | null;
    } | null;
  };
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

export type EntityView = "ranking" | "explore";

export type EntityQuery = {
  window?: number;
  view?: EntityView;
  source?: string;
  kind?: string;
  status?: string;
  marketType?: string;
  strategyCategory?: string;
  search?: string;
  sort?: string;
  direction?: "asc" | "desc";
  fullWindow?: boolean;
  headlineEligible?: boolean;
  limit?: number;
  offset?: number;
};

export type QueryValue = string | number | boolean | undefined;

/** Preserve explicit `false`. Omit only `undefined`. */
export function toSearchParams(params: Record<string, QueryValue>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  return search;
}

/** The API answers 4xx with { error, detail }; surface that rather than a bare status. */
async function get<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const url = new URL(API_BASE + path);
  const search = toSearchParams(params);
  search.forEach((value, key) => url.searchParams.set(key, value));
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

export function entityListParams(q: EntityQuery = {}): Record<string, QueryValue> {
  const view = q.view ?? "ranking";
  return {
    window: q.window ?? 90,
    view,
    source: q.source,
    kind: q.kind,
    status: q.status,
    marketType: q.marketType,
    strategyCategory: q.strategyCategory,
    search: q.search,
    sort: q.sort ?? (view === "explore" ? "name" : "alphaBtc"),
    direction: q.direction ?? (view === "explore" ? "asc" : "desc"),
    fullWindow: q.fullWindow,
    headlineEligible: q.headlineEligible,
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  };
}

export function listEntities(q: EntityQuery = {}) {
  return get<EntitiesResponse>("/entities", entityListParams(q));
}

export function entitiesSummary(q: EntityQuery = {}) {
  const params = entityListParams(q);
  delete params.limit;
  delete params.offset;
  delete params.direction;
  return get<EntitiesSummary>("/entities/summary", params);
}

export function getEntity(id: string) {
  return get<EntityDetail>(`/entities/${id}`);
}

export function getSeries(id: string, range: { from?: string; to?: string } = {}) {
  return get<SeriesResponse>(`/entities/${id}/series`, range);
}

export function getFollowers(id: string, limit = 100) {
  return get<FollowersResponse>(`/entities/${id}/followers`, { limit });
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

import { API_SORT, type SortKey } from "@/lib/vaultDisplay";
import type { EntityQuery, EntityView } from "@/lib/vaultbench";

export const SOURCES = [
  { value: "", label: "All venues" },
  { value: "hyperliquid", label: "Hyperliquid" },
  { value: "okx", label: "OKX" },
  { value: "enzyme", label: "Enzyme" },
  { value: "chamber", label: "Chamber" },
  { value: "drift", label: "Drift" },
] as const;

export const PAGE_SIZES = [25, 50, 100] as const;

export type DashState = {
  view: EntityView;
  window: number;
  source: string;
  search: string;
  sort: SortKey;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  status: string;
  kind: string;
  marketType: string;
  strategyCategory: string;
  coverage: "all" | "full" | "partial";
  publication: "all" | "ranked" | "withheld";
};

const WINDOWS = new Set([0, 7, 30, 90, 365]);
const SORTS = new Set<SortKey>(["alpha", "ret", "dd", "vol", "name"]);
const SOURCES_SET = new Set<string>(SOURCES.map((s) => s.value));
const PAGE_SIZE_SET = new Set<number>(PAGE_SIZES);

export const DEFAULT_DASH: DashState = {
  view: "ranking",
  window: 90,
  source: "",
  search: "",
  sort: "alpha",
  direction: "desc",
  page: 1,
  pageSize: 50,
  status: "",
  kind: "",
  marketType: "",
  strategyCategory: "",
  coverage: "all",
  publication: "all",
};

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function intIn(raw: string | null, allowed: Set<number>, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return allowed.has(n) ? n : fallback;
}

export function parseDashState(params: URLSearchParams): DashState {
  const view = pick(params.get("view"), ["ranking", "explore"] as const, "ranking");
  const sortFallback: SortKey = view === "explore" ? "name" : "alpha";
  const dirFallback: "asc" | "desc" = view === "explore" ? "asc" : "desc";
  const sortRaw = params.get("sort");
  const sort = sortRaw && SORTS.has(sortRaw as SortKey) ? (sortRaw as SortKey) : sortFallback;
  const sourceRaw = params.get("source") ?? "";
  return {
    view,
    window: intIn(params.get("window"), WINDOWS, 90),
    source: SOURCES_SET.has(sourceRaw) ? sourceRaw : "",
    search: (params.get("search") ?? "").slice(0, 100),
    sort,
    direction: pick(params.get("direction"), ["asc", "desc"] as const, dirFallback),
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
    pageSize: intIn(params.get("pageSize"), PAGE_SIZE_SET, 50),
    status: pick(params.get("status"), ["", "active", "closed", "delisted"] as const, ""),
    kind: pick(params.get("kind"), ["", "vault", "lead_trader"] as const, ""),
    marketType: pick(params.get("marketType"), ["", "spot", "perp", "mixed"] as const, ""),
    strategyCategory: pick(params.get("strategyCategory"), ["", "directional", "neutral", "yield"] as const, ""),
    coverage: pick(params.get("coverage"), ["all", "full", "partial"] as const, "all"),
    publication: pick(params.get("publication"), ["all", "ranked", "withheld"] as const, "all"),
  };
}

export function serializeDashState(state: DashState): URLSearchParams {
  const params = new URLSearchParams();
  const defaults: DashState = {
    ...DEFAULT_DASH,
    sort: state.view === "explore" ? "name" : "alpha",
    direction: state.view === "explore" ? "asc" : "desc",
  };
  const entries: [keyof DashState, string | number][] = [
    ["view", state.view],
    ["window", state.window],
    ["source", state.source],
    ["search", state.search],
    ["sort", state.sort],
    ["direction", state.direction],
    ["page", state.page],
    ["pageSize", state.pageSize],
    ["status", state.status],
    ["kind", state.kind],
    ["marketType", state.marketType],
    ["strategyCategory", state.strategyCategory],
    ["coverage", state.coverage],
    ["publication", state.publication],
  ];
  for (const [key, value] of entries) {
    if (String(value) === String(defaults[key])) continue;
    if (value === "" || value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}

export function dashHref(state: DashState): string {
  const q = serializeDashState(state).toString();
  return q ? `/dashboard?${q}` : "/dashboard";
}

export function toEntityQuery(state: DashState): EntityQuery {
  const explore = state.view === "explore";
  return {
    window: state.window,
    view: state.view,
    source: state.source || undefined,
    kind: state.kind || undefined,
    status: state.status || undefined,
    marketType: state.marketType || undefined,
    strategyCategory: state.strategyCategory || undefined,
    search: state.search.trim() || undefined,
    sort: API_SORT[state.sort],
    direction: state.direction,
    fullWindow: explore ? (state.coverage === "all" ? undefined : state.coverage === "full") : undefined,
    headlineEligible: explore
      ? state.publication === "all"
        ? undefined
        : state.publication === "ranked"
      : undefined,
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
  };
}

export const FILTER_RESET_KEYS: (keyof DashState)[] = [
  "view",
  "window",
  "source",
  "search",
  "sort",
  "direction",
  "pageSize",
  "status",
  "kind",
  "marketType",
  "strategyCategory",
  "coverage",
  "publication",
];

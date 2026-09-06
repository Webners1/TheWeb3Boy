"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import DuelChart, { N_FALLBACK, type ChartLine } from "@/components/dashboard/DuelChart";
import ExternalVenueLink from "@/components/ExternalVenueLink";
import { VenueMarks, venueProtocolLabel } from "@/components/VenueBadge";
import {
  API_BASE,
  compare,
  entitiesSummary,
  getEntity,
  listEntities,
  num,
  type EntityDetail,
} from "@/lib/vaultbench";
import {
  DEFAULT_DASH,
  PAGE_SIZES,
  SOURCES,
  dashHref,
  parseDashState,
  toEntityQuery,
  type DashState,
} from "@/lib/dashboardState";
import {
  BENCH_COLORS,
  DISPLAY,
  GLOSSARY,
  GRID,
  MONO,
  NAV_META,
  PIN_TONES,
  SANS,
  SORT_CHIPS,
  SORT_LABELS,
  WATCH_KEY,
  WINDOW_OPTS,
  alphaOf,
  canCompare,
  chip,
  dateLabels,
  money,
  pct,
  polyline,
  scalePoints,
  seg,
  seriesFor,
  toVault,
  tone,
  type SortKey,
  type Vault,
} from "@/lib/vaultDisplay";

type Tip = { title: string; body: string; x: number; y: number };

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia("(max-width: 619px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const EMPTY_WATCH: string[] = [];
let watchRaw = "";
let watchCache: string[] = EMPTY_WATCH;
const watchSubs = new Set<() => void>();

function readWatchList(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WATCH_KEY) || "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : EMPTY_WATCH;
  } catch {
    return EMPTY_WATCH;
  }
}

function subscribeWatch(cb: () => void) {
  watchSubs.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    watchSubs.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getWatchSnapshot() {
  const raw = window.localStorage.getItem(WATCH_KEY) || "[]";
  if (raw === watchRaw) return watchCache;
  watchRaw = raw;
  const next = readWatchList();
  watchCache = next.length ? next : EMPTY_WATCH;
  return watchCache;
}

function writeWatch(next: string[]) {
  try {
    window.localStorage.setItem(WATCH_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  watchRaw = "";
  watchSubs.forEach((fn) => fn());
}

function detailToVault(detail: EntityDetail, windowDays: number): Vault {
  const metrics = detail.metrics.find((row) => row.coverage.windowDays === windowDays) ?? null;
  return toVault({ ...detail, metrics });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="yv-dash" style={{ minHeight: "100vh", background: "#0B0908" }} />}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia("(max-width: 619px)").matches, () => false);
  const watch = useSyncExternalStore(subscribeWatch, getWatchSnapshot, () => EMPTY_WATCH);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseDashState(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(state.search);
  const debouncedSearch = useDebounced(searchInput, 320);
  const [amount, setAmount] = useState(1000);
  const [benches, setBenches] = useState<string[]>(["BTC"]);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [heroVault, setHeroVault] = useState<Vault | null>(null);
  const [pinVaultsHeld, setPinVaultsHeld] = useState<Vault[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // URL is the source of truth for back/forward; keep the input aligned.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from search params
    setSearchInput(state.search);
  }, [state.search]);

  const replaceState = useCallback(
    (patch: Partial<DashState>, resetPage = false) => {
      const next: DashState = { ...state, ...patch, search: patch.search ?? searchInput };
      if (resetPage) next.page = 1;
      const href = dashHref({ ...next, search: next.search });
      if (`${pathname}${searchParams.toString() ? `?${searchParams}` : ""}` === href) return;
      router.replace(href, { scroll: false });
    },
    [state, searchInput, pathname, router, searchParams],
  );

  useEffect(() => {
    if (debouncedSearch === state.search) return;
    replaceState({ search: debouncedSearch, page: 1 });
  }, [debouncedSearch, state.search, replaceState]);

  const saveWatch = useCallback((next: string[]) => {
    writeWatch(next);
  }, []);

  const query = toEntityQuery({ ...state, search: debouncedSearch });
  const {
    data: listData,
    error: listErr,
    isLoading: listLoading,
    isValidating: listValidating,
  } = useSWR(["entities", query], () => listEntities(query), { keepPreviousData: true });

  const {
    data: summary,
  } = useSWR(["entities-summary", query], () => entitiesSummary(query));

  const pageVaults = useMemo(() => (listData?.entities ?? []).map(toVault), [listData]);
  const pagination = listData?.pagination;
  const total = pagination?.total ?? 0;
  const pageSize = state.pageSize;
  const offset = pagination?.offset ?? (state.page - 1) * pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    if (!listData) return;
    if (total === 0 && state.page !== 1) {
      replaceState({ page: 1 });
      return;
    }
    if (total > 0 && state.page > totalPages) {
      replaceState({ page: totalPages });
    }
  }, [listData, total, state.page, totalPages, replaceState]);

  const censusKey =
    state.view === "ranking" && total === 0 && !listLoading
      ? (["explore-census", state.source, debouncedSearch] as const)
      : null;
  const { data: census } = useSWR(censusKey, () =>
    listEntities({
      view: "explore",
      window: state.window,
      source: state.source || undefined,
      search: debouncedSearch.trim() || undefined,
      sort: "name",
      direction: "asc",
      limit: 1,
      offset: 0,
    }),
  );

  useEffect(() => {
    if (heroId || pageVaults.length === 0) return;
    const first = pageVaults[0]!;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time challenger seed */
    setHeroId(first.id);
    setHeroVault(first);
    setPins((current) => (current.length ? current : [first.id]));
    setPinVaultsHeld((current) => (current.length ? current : [first]));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [heroId, pageVaults]);

  const missingIds = useMemo(() => {
    const known = new Set(pageVaults.map((v) => v.id));
    const ids = [heroId, ...pins].filter((id): id is string => typeof id === "string" && !known.has(id));
    return [...new Set(ids)];
  }, [pageVaults, heroId, pins]);

  const { data: fetchedExtras } = useSWR(
    missingIds.length ? ["entity-extras", state.window, missingIds.join(",")] : null,
    async () => {
      const rows = await Promise.all(
        missingIds.map(async (id) => {
          try {
            return detailToVault(await getEntity(id), state.window);
          } catch {
            return null;
          }
        }),
      );
      return rows.filter((row): row is Vault => row !== null);
    },
  );

  const { data: watchVaults } = useSWR(
    watchOnly && watch.length ? ["watch-entities", state.window, watch.join(",")] : null,
    async () => {
      const rows = await Promise.all(
        watch.map(async (id) => {
          try {
            return detailToVault(await getEntity(id), state.window);
          } catch {
            return null;
          }
        }),
      );
      return rows.filter((row): row is Vault => row !== null);
    },
  );

  const vaultIndex = useMemo(() => {
    const map = new Map<string, Vault>();
    for (const v of [...pinVaultsHeld, ...(fetchedExtras ?? []), ...pageVaults, ...(watchVaults ?? [])]) {
      map.set(v.id, v);
    }
    if (heroVault) map.set(heroVault.id, heroVault);
    return map;
  }, [pageVaults, fetchedExtras, watchVaults, pinVaultsHeld, heroVault]);

  const list = watchOnly ? (watchVaults ?? []) : pageVaults;
  const resolvedHeroId = heroId ?? list[0]?.id ?? null;
  const resolvedPins = pins;
  const hero = (resolvedHeroId ? vaultIndex.get(resolvedHeroId) : undefined) ?? list[0] ?? null;

  const {
    data: cmp,
    error: cmpErr,
  } = useSWR(
    resolvedHeroId && hero && canCompare(hero)
      ? (["compare", resolvedHeroId, benches.join(","), state.window] as const)
      : null,
    () => compare(resolvedHeroId!, benches.join(",") || "BTC", state.window),
  );

  const padY = 13;
  const windowDays = state.window;
  const sort = state.sort;
  const dir = state.direction;
  const btcRet = hero?.btc ?? null;
  const heroAlpha = hero ? alphaOf(hero) : null;
  const heroNav = hero?.nav ? NAV_META[hero.nav] : null;
  const beatCount = summary?.beatBtc ?? 0;
  const median = num(summary?.medianTwr ?? null);
  const bestAlpha = num(summary?.bestAlphaBtc ?? null);
  const trackedCapital = num(summary?.capitalUsd ?? null);
  const maxAlpha = Math.max(
    ...list.map((v) => {
      const a = alphaOf(v);
      return a === null ? 0 : Math.abs(a);
    }),
    0.001,
  );
  const pinVaults = resolvedPins.map((id) => vaultIndex.get(id)).filter((v): v is Vault => !!v);
  const A = amount;
  const N = cmp && cmp.entity.length > 1 ? cmp.entity.length : N_FALLBACK;
  const dates =
    cmp && cmp.entity.length > 1 ? cmp.entity.map((p) => p.asOf) : dateLabels(N, windowDays, hero?.asOf ?? null);
  const startDate = dates[0] ?? "";
  const endDate = dates[dates.length - 1] ?? "";
  const windowTag = (WINDOW_OPTS.find(([v]) => v === windowDays) || [0, "All"])[1];
  const filterCount =
    (state.source ? 1 : 0) +
    (state.status ? 1 : 0) +
    (state.kind ? 1 : 0) +
    (state.marketType ? 1 : 0) +
    (state.strategyCategory ? 1 : 0) +
    (state.coverage !== "all" ? 1 : 0) +
    (state.publication !== "all" ? 1 : 0) +
    (watchOnly ? 1 : 0) +
    (benches.length > 1 ? 1 : 0);
  const sourceLive = Boolean(listData && !listErr);
  const listError = listErr instanceof Error ? listErr.message : null;
  const pageBusy = listLoading || (listValidating && !listData);
  const fromRow = total === 0 ? 0 : offset + 1;
  const toRow = Math.min(offset + list.length, total);
  const venueLabel = SOURCES.find((s) => s.value === state.source)?.label ?? "All venues";

  const benchRet = (k: string) => {
    if (k === "BTC") return btcRet;
    if (k === "ETH") return hero?.eth ?? null;
    if (k === "SOL") return hero?.sol ?? null;
    return null;
  };

  const chartLines: ChartLine[] = useMemo(() => {
    const built: ChartLine[] = [];
    if (!hero || !canCompare(hero)) return built;
    const pinList = pinVaults.length ? pinVaults.filter(canCompare) : [hero];
    pinList.forEach((v, i) => {
      const real = v.id === resolvedHeroId && cmp && cmp.entity.length > 1 ? scalePoints(cmp.entity, A) : null;
      const fallback = seriesFor(v.id, v.ret, N);
      const vals = real && real.length > 1 ? resample(real, N) : fallback ? fallback.map((x) => x * A) : [];
      if (!vals.length) return;
      built.push({
        key: v.id,
        label: v.name,
        color: PIN_TONES[i] || "#5FD8C9",
        weight: v.id === resolvedHeroId ? 2.6 : 2,
        opacity: 1,
        isBench: false,
        values: vals,
      });
    });
    benches.forEach((b) => {
      const pts = cmp?.benchmarks[b];
      const real = pts && pts.length > 1 ? scalePoints(pts, A) : null;
      const fallback = seriesFor("bench" + b, benchRet(b), N);
      const vals = real ? resample(real, N) : fallback ? fallback.map((x) => x * A) : [];
      if (!vals.length) return;
      built.push({
        key: "bench-" + b,
        label: b + " buy & hold",
        color: BENCH_COLORS[b] ?? "#AFA290",
        weight: 1.7,
        opacity: 0.9,
        isBench: true,
        values: vals,
      });
    });
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinVaults, hero, resolvedHeroId, cmp, A, N, benches]);

  const tipOff = () => setTip(null);
  const tipFor = (key: string, e: { currentTarget: EventTarget & HTMLElement }) => {
    const g = GLOSSARY[key];
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
    setTip({ title: g[0], body: g[1], x: Math.max(10, Math.min(r.left, vw - 320)), y: r.bottom + 10 });
  };

  const resetAll = () => {
    setSearchInput("");
    setWatchOnly(false);
    setBenches(["BTC"]);
    router.replace(dashHref({ ...DEFAULT_DASH, view: state.view, window: state.window }), { scroll: false });
  };

  const rememberVault = (v: Vault) => {
    setHeroVault(v);
    setPinVaultsHeld((current) => {
      const next = current.filter((row) => row.id !== v.id).concat(v);
      return next.slice(-8);
    });
  };

  const makeHero = (v: Vault, e?: MouseEvent) => {
    e?.stopPropagation();
    if (!canCompare(v)) return;
    setHeroId(v.id);
    rememberVault(v);
    setPins(resolvedPins.indexOf(v.id) === -1 ? [v.id].concat(resolvedPins).slice(0, 3) : resolvedPins);
  };

  const togglePin = (v: Vault) => {
    const pinned = resolvedPins.indexOf(v.id) !== -1;
    rememberVault(v);
    setPins(
      pinned
        ? resolvedPins.filter((x) => x !== v.id)
        : resolvedPins.length >= 3
          ? resolvedPins.slice(1).concat([v.id])
          : resolvedPins.concat([v.id])
    );
    if (!pinned) setHeroId(v.id);
  };

  const setSort = (next: SortKey) => {
    if (sort === next) replaceState({ direction: dir === "desc" ? "asc" : "desc" }, true);
    else replaceState({ sort: next, direction: next === "name" ? "asc" : "desc" }, true);
  };

  const shareLine = hero && hero.ret !== null && heroAlpha !== null
    ? heroAlpha >= 0
      ? money(A) +
        " in " +
        hero.name +
        " over " +
        (windowDays || 90) +
        " days would be " +
        money(A * (1 + hero.ret)) +
        " — " +
        money(Math.abs(A * heroAlpha)) +
        " more than just holding Bitcoin."
      : money(A) +
        " in " +
        hero.name +
        " over " +
        (windowDays || 90) +
        " days would be " +
        money(A * (1 + hero.ret)) +
        " — " +
        money(Math.abs(A * heroAlpha)) +
        " less than just holding Bitcoin."
    : "Comparison unavailable — this entity has no computed return for the selected window.";

  const headers: { tipKey: string; label: string; sortKey: SortKey | null }[] = [
    { tipKey: "", label: "Vault", sortKey: "name" },
    { tipKey: "", label: "Venue", sortKey: null },
    { tipKey: "", label: "Shape", sortKey: null },
    { tipKey: "ret", label: "Return", sortKey: "ret" },
    { tipKey: "btc", label: "BTC", sortKey: null },
    { tipKey: "alpha", label: "Alpha vs BTC", sortKey: "alpha" },
    { tipKey: "beta", label: "Beta", sortKey: null },
    { tipKey: "vol", label: "Vol", sortKey: "vol" },
    { tipKey: "aum", label: "Capital", sortKey: null },
    { tipKey: "nav", label: "Quality", sortKey: null },
    { tipKey: "", label: "Source", sortKey: null },
    { tipKey: "", label: "Pin", sortKey: null },
  ];

  const numStyle: CSSProperties = {
    padding: `${padY}px 0`,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    fontFamily: MONO,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "#F4EEE2",
    fontWeight: 500,
  };
  const numDimStyle: CSSProperties = { ...numStyle, color: "#AFA290", fontWeight: 400 };

  return (
    <div
      className="yv-dash"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(120% 70% at 8% -8%, #16110D 0%, #0B0908 52%)",
        position: "relative",
        paddingBottom: 88,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          pointerEvents: "none",
          opacity: 0.42,
          mixBlendMode: "overlay",
          backgroundImage: "radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "rgba(11,9,8,.9)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid rgba(244,238,226,.1)",
        }}
      >
        <div
          style={{
            maxWidth: 1480,
            margin: "0 auto",
            padding: "10px clamp(14px,3vw,40px)",
            display: "flex",
            alignItems: "center",
            gap: "clamp(8px,1.6vw,18px)",
            flexWrap: "wrap",
          }}
          className="yv-header-bar"
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: MONO,
              fontSize: 12.5,
              color: "#F4EEE2",
              flex: "none",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#5FD8C9",
                boxShadow: "0 0 9px #5FD8C9",
                animation: "yv-pulse 2.4s ease-in-out infinite",
              }}
            />
            you<span style={{ color: "#6F6455" }}>vs</span>BTC
          </Link>
          <div
            className="yv-search"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid rgba(244,238,226,.16)",
              background: "rgba(244,238,226,.03)",
              borderRadius: 3,
              padding: "0 10px",
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 14, height: 14, flex: "none", color: "#6F6455" }}>
              <path fill="none" stroke="currentColor" strokeWidth="2" d="M10.5 3a7.5 7.5 0 105.3 12.8L21 21" />
            </svg>
            <input
              aria-label="Search vaults, addresses, or venues"
              placeholder={phone ? "Search vaults, addresses, or venues" : "Search vaults, addresses, or venues"}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value.slice(0, 100))}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: MONO,
                fontSize: 12.5,
                color: "#F4EEE2",
                background: "transparent",
                border: 0,
                outline: "none",
                padding: "11px 0",
              }}
            />
            {searchInput.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                style={{ background: "transparent", border: 0, color: "#6F6455", fontSize: 13, cursor: "pointer", padding: 6, minWidth: 28 }}
              >
                ✕
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#6F6455" }}>
              Stake
            </span>
            <input
              aria-label="Amount invested"
              type="number"
              min={1}
              step={100}
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
              style={{
                fontFamily: MONO,
                fontSize: 12.5,
                color: "#F4EEE2",
                background: "rgba(244,238,226,.03)",
                border: "1px solid rgba(244,238,226,.16)",
                borderRadius: 3,
                padding: 10,
                width: 92,
              }}
            />
          </div>
          <div className="yv-windows">
            {WINDOW_OPTS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => replaceState({ window: value }, true)} style={seg(windowDays === value)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setShowFilters((v) => !v); setTip(null); }} style={chip(showFilters)}>
            Filters {filterCount ? `· ${filterCount}` : ""}
          </button>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: sourceLive ? "#5FD8C9" : "#6F6455",
              flex: "none",
            }}
          >
            <i
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                display: "inline-block",
                background: sourceLive ? "#5FD8C9" : "#6F6455",
              }}
            />
            {listLoading ? "Loading" : sourceLive ? "Live API" : "API error"}
          </span>
        </div>

        {showFilters && (
          <div style={{ borderTop: "1px solid rgba(244,238,226,.1)", background: "rgba(20,13,8,.97)" }}>
            <div
              style={{
                maxWidth: 1480,
                margin: "0 auto",
                padding: "16px clamp(14px,3vw,40px)",
                display: "grid",
                gap: "18px 30px",
                gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              }}
            >
              <FilterGroup label="Benchmarks">
                {(["BTC", "ETH", "SOL"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setBenches((prev) =>
                        prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : prev.concat([k])
                      )
                    }
                    style={chip(benches.includes(k), BENCH_COLORS[k])}
                  >
                    {k} {pct(benchRet(k), 0)}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Rank by">
                {SORT_CHIPS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSort(k)}
                    style={chip(sort === k)}
                  >
                    {label}
                    {sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Kind">
                {([["", "All"], ["vault", "Vault"], ["lead_trader", "Lead trader"]] as const).map(([value, label]) => (
                  <button key={value || "all"} type="button" onClick={() => replaceState({ kind: value }, true)} style={chip(state.kind === value)}>
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Status">
                {([["", "All"], ["active", "Active"], ["closed", "Closed"], ["delisted", "Delisted"]] as const).map(([value, label]) => (
                  <button key={value || "all"} type="button" onClick={() => replaceState({ status: value }, true)} style={chip(state.status === value)}>
                    {label}
                  </button>
                ))}
                <span style={{ fontFamily: MONO, fontSize: 10, color: "#6F6455", maxWidth: 240 }}>
                  Filtering to Active hides closed and delisted entities and reintroduces survivorship bias.
                </span>
              </FilterGroup>
              <FilterGroup label="Market">
                {([["", "All"], ["spot", "Spot"], ["perp", "Perpetual"], ["mixed", "Mixed"]] as const).map(([value, label]) => (
                  <button key={value || "all"} type="button" onClick={() => replaceState({ marketType: value }, true)} style={chip(state.marketType === value)}>
                    {label}
                  </button>
                ))}
              </FilterGroup>
              <FilterGroup label="Strategy">
                {([["", "All"], ["directional", "Directional"], ["neutral", "Neutral"], ["yield", "Yield"]] as const).map(([value, label]) => (
                  <button key={value || "all"} type="button" onClick={() => replaceState({ strategyCategory: value }, true)} style={chip(state.strategyCategory === value)}>
                    {label}
                  </button>
                ))}
              </FilterGroup>
              {state.view === "explore" ? (
                <>
                  <FilterGroup label="Coverage">
                    {([["all", "All"], ["full", "Full window"], ["partial", "Partial window"]] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => replaceState({ coverage: value }, true)} style={chip(state.coverage === value)}>
                        {label}
                      </button>
                    ))}
                  </FilterGroup>
                  <FilterGroup label="Publication">
                    {([["all", "All"], ["ranked", "Ranked"], ["withheld", "Withheld"]] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => replaceState({ publication: value }, true)} style={chip(state.publication === value)}>
                        {label}
                      </button>
                    ))}
                  </FilterGroup>
                </>
              ) : null}
              <FilterGroup label="Scope">
                <button type="button" onClick={() => setWatchOnly((v) => !v)} style={chip(watchOnly, "#D8B25F")}>
                  ★ Watchlist {watch.length ? `· ${watch.length}` : ""}
                </button>
                {watchOnly ? (
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "#6F6455", maxWidth: 240 }}>
                    Watchlist loads saved IDs from the API, not only this page.
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={resetAll}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "#6F6455",
                    background: "transparent",
                    border: "1px dashed rgba(244,238,226,.2)",
                    borderRadius: 3,
                    padding: "9px 11px",
                    cursor: "pointer",
                    minHeight: 36,
                  }}
                >
                  Reset
                </button>
              </FilterGroup>
            </div>
          </div>
        )}
      </header>

      <main style={{ maxWidth: 1480, margin: "0 auto", padding: "clamp(16px,3vw,40px) clamp(12px,3vw,40px) 0" }}>
        <header style={{ marginBottom: "clamp(16px,2.4vw,28px)", maxWidth: 980 }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(1.8rem,4vw,3.4rem)", fontWeight: 800, lineHeight: 1.05, margin: 0 }}>
            Crypto copy trader and vault rankings
          </h1>
          <p style={{ fontFamily: SANS, fontSize: 15, color: "#AFA290", lineHeight: 1.6, margin: "12px 0 16px", maxWidth: 720 }}>
            Compare flow-neutral crypto performance with Bitcoin, Ethereum, and Solana across transparent windows and coverage data.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => replaceState({ view: "ranking", sort: "alpha", direction: "desc" }, true)}
              style={seg(state.view === "ranking")}
            >
              Rankings
            </button>
            <button
              type="button"
              onClick={() => replaceState({ view: "explore", sort: "name", direction: "asc" }, true)}
              style={seg(state.view === "explore")}
            >
              All vaults
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SOURCES.map((source) => (
              <button
                key={source.value || "all"}
                type="button"
                onClick={() => replaceState({ source: source.value }, true)}
                style={chip(state.source === source.value)}
              >
                {source.label}
              </button>
            ))}
          </div>
        </header>
        <section
          aria-label="Market summary"
          className="yv-strip"
          style={{
            background: "rgba(244,238,226,.1)",
            border: "1px solid rgba(244,238,226,.1)",
            borderRadius: 4,
            overflow: "hidden",
            marginBottom: "clamp(16px,2.4vw,28px)",
          }}
        >
          <StripCell
            label="BTC · this window"
            value={pct(btcRet)}
            valueColor="#E2793B"
            note={btcRet === null ? "Unavailable for the selected challenger" : `${money(A)} → ${money(A * (1 + btcRet))}`}
          />
          <StripCell
            label="Entities that beat BTC"
            value={
              <>
                {beatCount}
                <span style={{ fontFamily: MONO, fontSize: ".8rem", fontWeight: 400, color: "#6F6455" }}> / {summary?.withMetrics ?? 0}</span>
              </>
            }
            valueColor="#5FD8C9"
            note={`${summary?.total ?? 0} in this filtered population`}
          />
          <StripCell
            label="Median return"
            value={pct(median)}
            valueColor={tone(median === null || btcRet === null ? null : median - btcRet)}
            note={
              median === null || btcRet === null
                ? "Unavailable"
                : median >= btcRet
                  ? "ahead of BTC"
                  : `behind BTC by ${pct(Math.abs(median - btcRet), 0).replace("+", "")}`
            }
          />
          <div style={{ background: "#0B0908", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#6F6455" }}>
              Best alpha
            </span>
            <span style={{ fontFamily: DISPLAY, fontSize: "1.45rem", fontWeight: 700, color: "#5FD8C9", lineHeight: 1 }}>
              {pct(bestAlpha)}
            </span>
            {summary?.bestEntityId ? (
              <Link
                href={`/dashboard/vault/${summary.bestEntityId}`}
                className="yv-best"
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: "#AFA290",
                  textAlign: "left",
                  textDecoration: "underline",
                  textDecorationColor: "rgba(175,162,144,.4)",
                  textUnderlineOffset: 3,
                }}
              >
                View best entity →
              </Link>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#6F6455" }}>Unavailable</span>
            )}
          </div>
          <StripCell
            label="Capital tracked"
            value={money(trackedCapital, { compact: true })}
            valueColor="#F4EEE2"
            note="Sum of latest snapshot AUM in this filter"
          />
        </section>

        <section
          aria-label="Head to head"
          style={{
            borderTop: "2px solid #E2793B",
            background: "linear-gradient(180deg,rgba(226,121,59,.06),transparent 50%)",
            padding: "clamp(16px,2.2vw,26px)",
            marginBottom: "clamp(18px,2.6vw,30px)",
            borderLeft: "1px solid rgba(244,238,226,.1)",
            borderRight: "1px solid rgba(244,238,226,.1)",
            borderBottom: "1px solid rgba(244,238,226,.1)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline", marginBottom: 14 }}>
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#E2793B", margin: 0 }}>
              Round {windowTag} · {money(A)} in · {startDate} → {endDate}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setShareOpen(true); setCopied(false); }}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  color: "#0B0908",
                  background: "#5FD8C9",
                  border: 0,
                  borderRadius: 3,
                  padding: "9px 12px",
                  cursor: "pointer",
                  minHeight: 36,
                  fontWeight: 600,
                }}
              >
                Share verdict
              </button>
              {pinVaults.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPins([])}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    letterSpacing: ".07em",
                    textTransform: "uppercase",
                    color: "#AFA290",
                    background: "transparent",
                    border: "1px solid rgba(244,238,226,.2)",
                    borderRadius: 3,
                    padding: "9px 12px",
                    cursor: "pointer",
                    minHeight: 36,
                  }}
                >
                  Clear pins
                </button>
              )}
            </div>
          </div>

          <div className="yv-duel">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#5FD8C9" }}>
                Challenger
              </span>
              <h2
                style={{
                  fontFamily: DISPLAY,
                  fontSize: "clamp(1.1rem,2.1vw,1.55rem)",
                  fontWeight: 700,
                  margin: 0,
                  lineHeight: 1.15,
                  textWrap: "balance",
                  overflowWrap: "anywhere",
                }}
              >
                {hero ? hero.name : listLoading ? "Loading vaults…" : "—"}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {hero && <VenueMarks venue={hero.venue} protoSize={20} showChain={false} />}
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#AFA290" }}>
                  {hero ? `${venueProtocolLabel(hero.venue)} · ${hero.addr}` : ""}
                </span>
                {heroNav && (
                  <span
                    onMouseEnter={(e) => tipFor("nav", e)}
                    onMouseLeave={tipOff}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      padding: "3px 7px",
                      cursor: "help",
                      color: heroNav.color,
                      background: heroNav.color + "1a",
                    }}
                  >
                    {heroNav.label}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: "clamp(1.9rem,4.4vw,3rem)",
                  fontWeight: 800,
                  lineHeight: 1,
                  color: "#5FD8C9",
                  marginTop: "auto",
                }}
              >
                {hero && hero.ret !== null ? money(A * (1 + hero.ret)) : "—"}
              </div>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#AFA290" }}>
                {hero
                  ? hero.hasMetrics
                    ? `${pct(hero.ret)} time-weighted · ${hero.days ?? "—"} days of data`
                    : "Performance unavailable"
                  : "—"}
              </span>
            </div>

            <div className="yv-verdict">
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#6F6455" }}>
                Verdict
              </span>
              <span
                style={{
                  fontFamily: DISPLAY,
                  fontSize: "clamp(1.35rem,3vw,2.1rem)",
                  fontWeight: 800,
                  lineHeight: 1,
                  color: tone(heroAlpha),
                  textAlign: "center",
                }}
              >
                {heroAlpha === null
                  ? "—"
                  : (heroAlpha >= 0 ? "+" : "−") + money(Math.abs(A * heroAlpha))}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: tone(heroAlpha),
                  textAlign: "center",
                }}
              >
                {heroAlpha === null ? "Comparison unavailable" : heroAlpha >= 0 ? "Vault wins" : "Bitcoin wins"}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6F6455", textAlign: "center", maxWidth: 190, lineHeight: 1.5 }}>
                {heroAlpha === null
                  ? "Challenge BTC is disabled until this entity has a computed return and BTC series."
                  : heroAlpha >= 0
                    ? `Kept ${pct(heroAlpha, 1)} more of your stake than holding BTC.`
                    : `Holding BTC would have left you ${money(Math.abs(A * heroAlpha))} richer.`}
              </span>
            </div>

            <div className="yv-defender" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#E2793B" }}>
                Defender
              </span>
              <h2 style={{ fontFamily: DISPLAY, fontSize: "clamp(1.1rem,2.1vw,1.55rem)", fontWeight: 700, margin: 0, lineHeight: 1.15 }}>
                Bitcoin, bought and held
              </h2>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#AFA290" }}>Same dates · no fees · no rebalancing</span>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: "clamp(1.9rem,4.4vw,3rem)",
                  fontWeight: 800,
                  lineHeight: 1,
                  color: "#E2793B",
                  marginTop: "auto",
                }}
              >
                {btcRet === null ? "—" : money(A * (1 + btcRet))}
              </div>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#AFA290" }}>{pct(btcRet)} over the window</span>
            </div>
          </div>

          {cmpErr instanceof Error && (
            <p style={{ fontFamily: MONO, fontSize: 11.5, color: "#E2793B", margin: "14px 0 0" }}>
              Comparison failed: {cmpErr.message}
            </p>
          )}

          <div className="yv-chart-grid">
            <DuelChart lines={chartLines} dates={dates} amount={A} windowDays={windowDays} />

            <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
              {pinVaults.map((v, i) => {
                const a = alphaOf(v);
                const isHero = v.id === resolvedHeroId;
                return (
                  <div
                    key={v.id}
                    style={{
                      border: `1px solid ${(PIN_TONES[i] || "#5FD8C9") + "66"}`,
                      borderRadius: 3,
                      padding: 13,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      background: "rgba(244,238,226,.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: SANS,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: "#F4EEE2",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v.name}
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#6F6455", marginTop: 3 }}>
                          {venueProtocolLabel(v.venue)} · {v.addr}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="yv-unpin"
                        onClick={() => setPins(resolvedPins.filter((x) => x !== v.id))}
                        aria-label="Unpin"
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "#6F6455",
                          cursor: "pointer",
                          fontSize: 13,
                          padding: 6,
                          minWidth: 30,
                          minHeight: 30,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: DISPLAY, fontSize: "1.2rem", fontWeight: 700, color: tone(a), lineHeight: 1 }}>
                        {v.ret === null ? "—" : money(A * (1 + v.ret))}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "#AFA290" }}>{pct(v.ret)} return</span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: tone(a) }}>
                      {a === null ? "Comparison unavailable" : (a >= 0 ? "+" : "−") + money(Math.abs(A * a)) + " vs BTC"}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: 8,
                        borderTop: "1px solid rgba(244,238,226,.09)",
                        paddingTop: 8,
                        fontFamily: MONO,
                        fontSize: 11,
                        color: "#AFA290",
                      }}
                    >
                      <PinStat label="Beta" value={v.beta === null ? "—" : v.beta.toFixed(2)} />
                      <PinStat label="Vol" value={pct(v.vol, 0)} />
                      <PinStat label="Max DD" value={v.dd === null ? "—" : pct(-v.dd, 0)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setHeroId(v.id)}
                      style={{
                        minHeight: 38,
                        fontFamily: MONO,
                        fontSize: 10.5,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        border: 0,
                        padding: 9,
                        color: isHero ? "#0B0908" : "#F4EEE2",
                        background: isHero ? "#5FD8C9" : "rgba(244,238,226,.08)",
                        fontWeight: isHero ? 600 : 400,
                      }}
                    >
                      {isHero ? "In the ring ✓" : "Put in the ring"}
                    </button>
                  </div>
                );
              })}
              {pinVaults.length < 3 && (
                <div
                  style={{
                    border: "1px dashed rgba(244,238,226,.18)",
                    borderRadius: 3,
                    padding: 14,
                    fontFamily: MONO,
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: "#6F6455",
                  }}
                >
                  {pinVaults.length === 0
                    ? "Pin any vault from the list to draw it on this axis. Up to three at once."
                    : `Pin ${3 - pinVaults.length} more to compare side by side.`}
                </div>
              )}
            </div>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: "1rem", fontWeight: 700, margin: 0 }}>
            {state.view === "ranking" ? "Ranked vaults" : "All known vaults"}
          </h2>
          <p style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#6F6455", margin: 0 }}>
            {pageBusy ? "Loading…" : total === 0 ? "None" : `${fromRow}–${toRow} of ${total}`} · by {SORT_LABELS[sort]} · {windowTag}
          </p>
        </div>

        {listError && (
          <p style={{ fontFamily: MONO, fontSize: 12, color: "#FF9A56", borderLeft: "2px solid #E2793B", paddingLeft: 12, margin: "0 0 16px" }}>
            Couldn&apos;t reach the API ({listError}). Base URL: <code>{API_BASE}</code>
          </p>
        )}

        {!listError && !pageBusy && list.length === 0 && (
          <p style={{ fontFamily: SANS, fontSize: 14, color: "#AFA290", borderLeft: "2px solid #5FD8C9", paddingLeft: 12, margin: "0 0 16px", lineHeight: 1.6 }}>
            {watchOnly
              ? "No saved vaults on this watchlist."
              : state.search.trim()
                ? "No vaults match that search."
                : state.view === "ranking" && (census?.pagination.total ?? 0) > 0
                  ? `No eligible ${venueLabel} metrics for this window. Switch to All vaults to see known entities.`
                  : state.source === "okx"
                    ? "No OKX entities have been successfully ingested yet."
                    : state.source
                      ? `No ${venueLabel} entities match these filters.`
                      : "No entities match these filters."}
          </p>
        )}

        {list.length > 0 && (
          <div className="yv-table yv-only-wide" style={{ border: "1px solid rgba(244,238,226,.12)", borderRadius: 4 }}>
            <div
              className="yv-table-grid"
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                padding: "0 clamp(12px,1.4vw,18px)",
                background: "rgba(244,238,226,.04)",
                borderBottom: "1px solid rgba(244,238,226,.12)",
              }}
            >
              {headers.map((h) => {
                const active = h.sortKey && sort === h.sortKey;
                const right = ["Return", "BTC", "Alpha vs BTC", "Beta", "Vol", "Capital", "Quality", "Shape"].includes(h.label);
                return (
                  <button
                    key={h.label || "pin"}
                    type="button"
                    onClick={() => {
                      if (!h.sortKey) return;
                      setSort(h.sortKey);
                    }}
                    onMouseEnter={h.tipKey ? (e) => tipFor(h.tipKey, e) : undefined}
                    onMouseLeave={h.tipKey ? tipOff : undefined}
                    onFocus={h.tipKey ? (e) => tipFor(h.tipKey, e) : undefined}
                    onBlur={h.tipKey ? tipOff : undefined}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      background: "transparent",
                      border: 0,
                      padding: "12px 0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: right ? "flex-end" : "flex-start",
                      cursor: h.sortKey ? "pointer" : "default",
                      color: active ? "#5FD8C9" : "#6F6455",
                    }}
                  >
                    {h.label}
                    {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
                    {h.tipKey ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          border: "1px solid currentColor",
                          fontSize: 8,
                          opacity: 0.6,
                          marginLeft: 5,
                        }}
                      >
                        i
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {list.map((v, i) => {
              const a = alphaOf(v);
              const nav = v.nav ? NAV_META[v.nav] : null;
              const pinned = resolvedPins.indexOf(v.id) !== -1;
              const watched = watch.indexOf(v.id) !== -1;
              const isHero = v.id === resolvedHeroId;
              const vals = seriesFor(v.id, v.ret, 26);
              const rank = offset + i + 1;
              return (
                <div
                  key={v.id}
                  className="yv-row yv-table-grid"
                  onClick={() => togglePin(v)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    padding: "0 clamp(12px,1.4vw,18px)",
                    borderBottom: "1px solid rgba(244,238,226,.07)",
                    cursor: "pointer",
                    transition: "background .15s",
                    background: isHero ? "rgba(95,216,201,.07)" : pinned ? "rgba(95,216,201,.035)" : undefined,
                  }}
                >
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveWatch(watched ? watch.filter((x) => x !== v.id) : watch.concat([v.id]));
                      }}
                      aria-label="Toggle watchlist"
                      style={{
                        flex: "none",
                        width: 26,
                        height: 26,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        fontSize: 13,
                        color: watched ? "#D8B25F" : "rgba(244,238,226,.18)",
                      }}
                    >
                      ★
                    </button>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        flex: "none",
                        width: 26,
                        height: 26,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 2,
                        color: rank <= 3 ? "#0B0908" : "#6F6455",
                        background: rank <= 3 ? "#F4EEE2" : "rgba(244,238,226,.06)",
                      }}
                    >
                      {String(rank).padStart(2, "0")}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Link
                          href={`/dashboard/vault/${v.id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontFamily: SANS,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: "#F4EEE2",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v.name}
                        </Link>
                        {isHero && (
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 9,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              color: "#0B0908",
                              background: "#5FD8C9",
                              borderRadius: 2,
                              padding: "2px 5px",
                            }}
                          >
                            In ring
                          </span>
                        )}
                      </span>
                      <span style={{ display: "block", fontFamily: MONO, fontSize: 10.5, color: "#6F6455", marginTop: 3 }}>
                        {v.addr}
                      </span>
                    </span>
                  </div>
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <VenueMarks venue={v.venue} />
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: "#AFA290",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {venueProtocolLabel(v.venue)}
                    </span>
                  </div>
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                    {vals ? (
                      <svg viewBox="0 0 88 26" aria-hidden="true" style={{ width: 88, height: 26 }}>
                        <polyline
                          points={polyline(vals, 88, 26, 3)}
                          fill="none"
                          stroke={tone(a)}
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 10, color: "#6F6455" }}>—</span>
                    )}
                  </div>
                  <div style={numStyle}>{pct(v.ret)}</div>
                  <div style={numDimStyle}>{pct(v.btc)}</div>
                  <div
                    style={{
                      padding: `${padY}px 0`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 5,
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 13.5,
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        color: tone(a),
                      }}
                    >
                      {pct(a)}
                    </span>
                    <span
                      style={{
                        display: "block",
                        width: "100%",
                        maxWidth: 104,
                        height: 3,
                        background: "rgba(244,238,226,.09)",
                        borderRadius: 99,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <i
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          ...(a !== null && a >= 0 ? { left: "50%" } : { right: "50%" }),
                          width: `${a === null ? 0 : ((Math.abs(a) / maxAlpha) * 50).toFixed(1)}%`,
                          background: tone(a),
                        }}
                      />
                    </span>
                  </div>
                  <div style={numDimStyle}>{v.beta === null ? "—" : v.beta.toFixed(2)}</div>
                  <div style={numDimStyle}>{pct(v.vol, 0)}</div>
                  <div style={numDimStyle}>{money(v.aum, { compact: true })}</div>
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                    <span
                      onMouseEnter={(e) => tipFor("nav", e)}
                      onMouseLeave={tipOff}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        padding: "4px 8px",
                        borderRadius: 2,
                        color: nav?.color ?? "#6F6455",
                        background: (nav?.color ?? "#6F6455") + "1a",
                        cursor: "help",
                        flex: "none",
                      }}
                    >
                      <i style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", display: "inline-block", background: nav?.color ?? "#6F6455" }} />
                      {v.hasMetrics ? `${v.days ?? "—"}d · ${nav?.label ?? "n/a"}` : "Unavailable"}
                    </span>
                  </div>
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                    <ExternalVenueLink href={v.externalUrl} venue={v.venue} source={v.source} compact />
                  </div>
                  <div style={{ padding: `${padY}px 0`, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        padding: "5px 8px",
                        borderRadius: 2,
                        border: `1px solid ${pinned ? "#5FD8C9" : "rgba(244,238,226,.2)"}`,
                        color: pinned ? "#5FD8C9" : "#6F6455",
                      }}
                    >
                      {pinned ? "Pinned ✓" : "+ Pin"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {list.length > 0 && (
          <div className="yv-only-narrow">
            {list.map((v, i) => {
              const a = alphaOf(v);
              const nav = v.nav ? NAV_META[v.nav] : null;
              const pinned = resolvedPins.indexOf(v.id) !== -1;
              const watched = watch.indexOf(v.id) !== -1;
              const isHero = v.id === resolvedHeroId;
              const vals = seriesFor(v.id, v.ret, 26);
              const rank = offset + i + 1;
              return (
                <div
                  key={v.id}
                  style={{
                    border: `1px solid ${isHero ? "rgba(95,216,201,.45)" : "rgba(244,238,226,.12)"}`,
                    borderRadius: 4,
                    padding: 15,
                    background: isHero ? "rgba(95,216,201,.05)" : "rgba(244,238,226,.02)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 9, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontVariantNumeric: "tabular-nums",
                          flex: "none",
                          width: 26,
                          height: 26,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 2,
                          color: i < 3 ? "#0B0908" : "#6F6455",
                          background: i < 3 ? "#F4EEE2" : "rgba(244,238,226,.06)",
                        }}
                      >
                        {String(rank).padStart(2, "0")}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/dashboard/vault/${v.id}`} style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: "#F4EEE2", lineHeight: 1.25, overflowWrap: "anywhere" }}>
                          {v.name}
                        </Link>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                          <VenueMarks venue={v.venue} showChain={false} />
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10.5,
                              color: "#6F6455",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {venueProtocolLabel(v.venue)} · {v.addr}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveWatch(watched ? watch.filter((x) => x !== v.id) : watch.concat([v.id]))}
                      aria-label="Toggle watchlist"
                      style={{
                        flex: "none",
                        width: 44,
                        height: 44,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: `1px solid ${watched ? "rgba(216,178,95,.5)" : "rgba(244,238,226,.14)"}`,
                        borderRadius: 3,
                        cursor: "pointer",
                        fontSize: 15,
                        color: watched ? "#D8B25F" : "rgba(244,238,226,.3)",
                      }}
                    >
                      ★
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: DISPLAY, fontSize: "1.4rem", fontWeight: 700, lineHeight: 1, color: tone(a) }}>
                        {v.ret === null ? "—" : money(A * (1 + v.ret))}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#AFA290", marginTop: 6 }}>
                        {v.btc === null ? "BTC comparison unavailable" : `vs ${money(A * (1 + v.btc))} in BTC`}
                      </div>
                    </div>
                    {vals ? (
                    <svg viewBox="0 0 108 40" aria-hidden="true" style={{ width: 108, height: 40, flex: "none" }}>
                      <polyline
                        points={polyline(vals, 108, 40, 4)}
                        fill="none"
                        stroke={tone(a)}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "#6F6455" }}>Unavailable</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 11 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: tone(a) }}>
                      {a === null ? "Comparison unavailable" : (a >= 0 ? "Beat BTC by " : "Behind BTC by ") + money(Math.abs(A * a))}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        padding: "4px 8px",
                        borderRadius: 2,
                        color: nav?.color ?? "#6F6455",
                        background: (nav?.color ?? "#6F6455") + "1a",
                        flex: "none",
                      }}
                    >
                      <i style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", display: "inline-block", background: nav?.color ?? "#6F6455" }} />
                      {nav?.label ?? "Unavailable"}
                    </span>
                  </div>
                  <div className="yv-card-metrics" style={{ marginTop: 13, paddingTop: 11, borderTop: "1px solid rgba(244,238,226,.09)", fontFamily: MONO, fontSize: 12, color: "#F4EEE2" }}>
                    <PinStat label="Return" value={pct(v.ret)} />
                    <PinStat label="Alpha" value={pct(a)} />
                    <PinStat label="Beta" value={v.beta === null ? "—" : v.beta.toFixed(2)} />
                    <PinStat label="Capital" value={money(v.aum, { compact: true })} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                    <button
                      type="button"
                      onClick={(e) => makeHero(v, e)}
                      disabled={!canCompare(v)}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        cursor: canCompare(v) ? "pointer" : "not-allowed",
                        border: 0,
                        padding: "11px 10px",
                        color: isHero ? "#0B0908" : "#F4EEE2",
                        background: isHero ? "#5FD8C9" : "rgba(244,238,226,.08)",
                        fontWeight: isHero ? 600 : 400,
                        opacity: canCompare(v) ? 1 : 0.45,
                      }}
                    >
                      {!canCompare(v) ? "No comparison" : isHero ? "In the ring ✓" : "Challenge BTC"}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(v)}
                      style={{
                        flex: "none",
                        minHeight: 44,
                        padding: "0 14px",
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        background: "transparent",
                        border: `1px solid ${pinned ? "#5FD8C9" : "rgba(244,238,226,.18)"}`,
                        color: pinned ? "#5FD8C9" : "#AFA290",
                      }}
                    >
                      {pinned ? "Pinned ✓" : "+ Pin"}
                    </button>
                    <ExternalVenueLink href={v.externalUrl} venue={v.venue} source={v.source} />
                    <Link
                      href={`/dashboard/vault/${v.id}`}
                      style={{
                        flex: "none",
                        minHeight: 44,
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "0 12px",
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        color: "#5FD8C9",
                        border: "1px solid rgba(95,216,201,.35)",
                      }}
                    >
                      Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!watchOnly && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 16 }}>
            <button type="button" disabled={state.page <= 1} onClick={() => replaceState({ page: state.page - 1 })} style={chip(false)}>
              Previous
            </button>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "#AFA290" }}>
              Page {total === 0 ? 0 : state.page} of {total === 0 ? 0 : totalPages} · {total === 0 ? "0–0 of 0" : `${fromRow}–${toRow} of ${total}`}
            </span>
            <button type="button" disabled={state.page >= totalPages || total === 0} onClick={() => replaceState({ page: state.page + 1 })} style={chip(false)}>
              Next
            </button>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#6F6455" }}>Page size</span>
            {PAGE_SIZES.map((size) => (
              <button key={size} type="button" onClick={() => replaceState({ pageSize: size }, true)} style={chip(state.pageSize === size)}>
                {size}
              </button>
            ))}
          </div>
        )}

        <p style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.7, color: "#6F6455", margin: "24px 0 0", maxWidth: 720 }}>
          Vault returns are time-weighted with flows removed; benchmarks are buy-and-hold over the same dates. Every series is
          indexed to your stake at the shared start date.{" "}
          {sourceLive
            ? "Live data from the youVsBTC API."
            : "The page swaps to real records when the API responds."}{" "}
          <a href="https://github.com/Webners1/youVsBtc" target="_blank" rel="noopener">
            Source
          </a>
        </p>
      </main>

      {shareOpen && hero && (
        <ShareModal
          windowTag={String(windowTag)}
          endDate={endDate}
          verdictWord={heroAlpha === null ? "Unavailable" : heroAlpha >= 0 ? "Vault wins" : "Bitcoin wins"}
          verdictTone={tone(heroAlpha)}
          verdictAmount={heroAlpha === null ? "—" : (heroAlpha >= 0 ? "+" : "−") + money(Math.abs(A * heroAlpha))}
          shareLine={shareLine}
          shareSparkVault={polyline(seriesFor(hero.id, hero.ret, 40) ?? [1, 1], 360, 90, 5)}
          shareSparkBtc={polyline(seriesFor("benchBTC", btcRet, 40) ?? [1, 1], 360, 90, 5)}
          heroName={hero.name}
          heroOut={hero.ret === null ? "—" : money(A * (1 + hero.ret))}
          btcOut={btcRet === null ? "—" : money(A * (1 + btcRet))}
          copyLabel={copied ? "Copied ✓" : "Copy verdict text"}
          onCopy={() => {
            try {
              void navigator.clipboard.writeText(shareLine + " — youvsbtc");
            } catch {
              /* ignore */
            }
            setCopied(true);
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {tip && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            zIndex: 99,
            left: tip.x,
            top: tip.y,
            maxWidth: 300,
            padding: "12px 14px",
            border: "1px solid rgba(95,216,201,.35)",
            borderRadius: 4,
            background: "rgba(14,11,9,.98)",
            boxShadow: "0 18px 40px rgba(0,0,0,.55)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              display: "block",
              fontFamily: MONO,
              fontSize: 10.5,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "#5FD8C9",
              marginBottom: 6,
            }}
          >
            {tip.title}
          </span>
          <span style={{ display: "block", fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: "#F4EEE2" }}>
            {tip.body}
          </span>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#6F6455" }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function StripCell({
  label,
  value,
  valueColor,
  note,
}: {
  label: string;
  value: ReactNode;
  valueColor: string;
  note: ReactNode;
}) {
  return (
    <div style={{ background: "#0B0908", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#6F6455" }}>
        {label}
      </span>
      <span style={{ fontFamily: DISPLAY, fontSize: "1.45rem", fontWeight: 700, color: valueColor, lineHeight: 1 }}>{value}</span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#AFA290" }}>{note}</span>
    </div>
  );
}

function PinStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <em style={{ fontStyle: "normal", color: "#6F6455", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase" }}>
        {label}
      </em>
      {value}
    </span>
  );
}

function ShareModal({
  windowTag,
  endDate,
  verdictWord,
  verdictTone,
  verdictAmount,
  shareLine,
  shareSparkVault,
  shareSparkBtc,
  heroName,
  heroOut,
  btcOut,
  copyLabel,
  onCopy,
  onClose,
}: {
  windowTag: string;
  endDate: string;
  verdictWord: string;
  verdictTone: string;
  verdictAmount: string;
  shareLine: string;
  shareSparkVault: string;
  shareSparkBtc: string;
  heroName: string;
  heroOut: string;
  btcOut: string;
  copyLabel: string;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="yv-share-scrim" role="dialog" aria-label="Share verdict" style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(6,5,4,.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, animation: "yv-rise .18s ease-out" }}>
        <div
          className="yv-share-card"
          style={{
            border: "1px solid rgba(244,238,226,.16)",
            background: "radial-gradient(120% 80% at 10% 0%, #1A130D 0%, #0B0908 60%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 11, color: "#F4EEE2" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5FD8C9", boxShadow: "0 0 8px #5FD8C9" }} />
              you<span style={{ color: "#6F6455" }}>vs</span>BTC
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#6F6455" }}>
              {windowTag} · {endDate}
            </span>
          </div>
          <p style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "#E2793B", margin: "24px 0 10px" }}>
            {verdictWord}
          </p>
          <div className="yv-share-amount" style={{ fontFamily: DISPLAY, fontWeight: 800, lineHeight: 1, color: verdictTone }}>{verdictAmount}</div>
          <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: "#F4EEE2", margin: "16px 0 0" }}>{shareLine}</p>
          <svg viewBox="0 0 360 90" aria-hidden="true" style={{ width: "100%", height: "auto", display: "block", margin: "20px 0 4px" }}>
            <polyline points={shareSparkVault} fill="none" stroke="#5FD8C9" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={shareSparkBtc} fill="none" stroke="#E2793B" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              borderTop: "1px solid rgba(244,238,226,.1)",
              paddingTop: 12,
              marginTop: 10,
              fontFamily: MONO,
              fontSize: 10.5,
              color: "#6F6455",
            }}
          >
            <span style={{ color: "#5FD8C9" }}>
              {heroName} {heroOut}
            </span>
            <span style={{ color: "#E2793B" }}>BTC {btcOut}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={onCopy}
            style={{
              flex: 1,
              minHeight: 44,
              fontFamily: MONO,
              fontSize: 11.5,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "#0B0908",
              background: "#5FD8C9",
              border: 0,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: "none",
              minHeight: 44,
              padding: "0 18px",
              fontFamily: MONO,
              fontSize: 11.5,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "#AFA290",
              background: "transparent",
              border: "1px solid rgba(244,238,226,.2)",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function resample(values: number[], n: number): number[] {
  if (values.length === n) return values;
  if (values.length < 2) return Array.from({ length: n }, () => values[0] ?? 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    const f = t - lo;
    out.push(values[lo]! * (1 - f) + values[hi]! * f);
  }
  return out;
}

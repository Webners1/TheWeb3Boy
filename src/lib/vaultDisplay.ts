/**
 * Display helpers for the youVsBTC dashboard. Visual rules come from
 * E:\design referrence\dashboard-v2-final.dc.html + vault-data.js.
 * Numbers are parsed from the API only at the point of display.
 */

import type { CSSProperties } from "react";
import { formatPct, num, shortName, type Entity, type SeriesPoint } from "@/lib/vaultbench";

export const WATCH_KEY = "youvsbtc:watchlist:v1";
export const GRID =
  "minmax(190px,2.1fr) minmax(110px,1fr) 100px .82fr .78fr 1.12fr .68fr .68fr .82fr .92fr 92px";
export const PIN_TONES = ["#5FD8C9", "#B58AFF", "#D8B25F"] as const;
export const BENCH_COLORS: Record<string, string> = {
  BTC: "#E2793B",
  ETH: "#627EEA",
  SOL: "#14F195",
};
export const WINDOW_OPTS = [
  [7, "7d"],
  [30, "30d"],
  [90, "90d"],
  [365, "1y"],
  [0, "All"],
] as const;

export const GLOSSARY: Record<string, [string, string]> = {
  ret: [
    "Return",
    "Time-weighted return over the window. Deposits and withdrawals are stripped out, so a vault can't look good just because money flowed in.",
  ],
  btc: ["BTC return", "Buy-and-hold Bitcoin over exactly the same dates as the vault's coverage."],
  alpha: [
    "Alpha vs BTC",
    "Vault return minus BTC return over the same dates. Positive means you'd have done better here than holding BTC.",
  ],
  beta: ["Beta", "How hard the vault moves with BTC. 1.0 tracks BTC; 0 is market-neutral; negative moves against it."],
  vol: ["Volatility", "Annualised standard deviation of daily returns — how bumpy the ride was."],
  dd: ["Max drawdown", "Largest peak-to-trough fall inside the window. The worst moment to have panicked."],
  aum: ["Capital", "Assets under management on the latest record. Small vaults move on tiny flows."],
  days: [
    "Coverage",
    "Days of NAV data inside the selected window. Short coverage means the comparison is on fewer days than the label suggests.",
  ],
  nav: [
    "NAV quality",
    "Verified NAV passes upstream sanity checks. Partial has gaps. Artifact means reported return above ±1000% or beta above ±50 — a data fault, not performance.",
  ],
};

export const NAV_META = {
  verified: { label: "Verified", color: "#5FD8C9", note: "NAV passes sanity checks" },
  partial: { label: "Partial", color: "#D8B25F", note: "gaps in NAV history" },
  artifact: { label: "Artifact", color: "#E2793B", note: "upstream NAV fault, not performance" },
} as const;

export type NavKind = keyof typeof NAV_META;

export type Vault = {
  id: string;
  name: string;
  addr: string;
  venue: string;
  aum: number | null;
  ret: number;
  btc: number;
  eth: number | null;
  sol: number | null;
  beta: number | null;
  vol: number;
  dd: number;
  days: number;
  nav: NavKind;
  asOf: string | null;
};

export type SortKey = "alpha" | "ret" | "dd" | "vol" | "aum" | "days" | "name";

export const SORT_CHIPS: [SortKey, string][] = [
  ["alpha", "Alpha"],
  ["ret", "Return"],
  ["dd", "Drawdown"],
  ["vol", "Volatility"],
  ["aum", "Capital"],
  ["name", "Name"],
];

export const SORT_LABELS: Record<SortKey, string> = {
  alpha: "alpha vs BTC",
  ret: "return",
  dd: "max drawdown",
  vol: "volatility",
  aum: "capital",
  days: "coverage",
  name: "name",
};

export const API_SORT: Partial<Record<SortKey, string>> = {
  alpha: "alphaBtc",
  ret: "twr",
  dd: "maxDrawdown",
  vol: "volatility",
  name: "name",
};

export function navOf(e: Entity): NavKind {
  const m = e.metrics;
  if (!m) return "partial";
  const twr = num(m.twr);
  const beta = num(m.betaBtc);
  if ((twr !== null && Math.abs(twr) > 10) || (beta !== null && Math.abs(beta) > 50)) return "artifact";
  if (!m.coverage.isFullWindow || m.coverage.navQuality === "partial") return "partial";
  if (m.coverage.navQuality === "artifact") return "artifact";
  return "verified";
}

export function shortAddr(id: string): string {
  if (/^0x[0-9a-f]{40}$/i.test(id)) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  if (id.length > 14) return `${id.slice(0, 4)}…${id.slice(-4)}`;
  return id;
}

export function toVault(e: Entity): Vault {
  const m = e.metrics;
  return {
    id: e.id,
    name: shortName(e.name),
    addr: shortAddr(e.externalId),
    venue: e.venue,
    aum: num(e.aumUsd),
    ret: num(m?.twr) ?? 0,
    btc: num(m?.benchTwrBtc) ?? 0,
    eth: num(m?.benchTwrEth),
    sol: num(m?.benchTwrSol),
    beta: num(m?.betaBtc),
    vol: num(m?.volatility) ?? 0,
    dd: Math.abs(num(m?.maxDrawdown) ?? 0),
    days: m?.coverage.daysCovered ?? 0,
    nav: navOf(e),
    asOf: m?.asOf ?? e.aumAsOf,
  };
}

export function alphaOf(v: Vault): number {
  return v.ret - v.btc;
}

export function isJunk(v: Vault): boolean {
  return v.nav === "artifact";
}

export function tone(n: number): string {
  return n >= 0 ? "#5FD8C9" : "#E2793B";
}

export function money(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (opts?.compact && abs >= 1000) {
    const units: [number, string][] = [
      [1e9, "B"],
      [1e6, "M"],
      [1e3, "K"],
    ];
    for (const [d, s] of units) {
      if (abs >= d) return "$" + (v / d).toFixed(abs / d >= 100 ? 0 : 1) + s;
    }
  }
  const digits = abs >= 1000 ? 0 : 2;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return formatPct(String(n), digits);
}

export function dateLabels(n: number, windowDays: number, end: string | null): string[] {
  const last = end ? new Date(end + "T00:00:00Z") : new Date();
  const span = windowDays || 90;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(last.getTime());
    d.setUTCDate(d.getUTCDate() - Math.round(((n - 1 - i) / (n - 1)) * span));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Deterministic per-vault series ending at (1 + total return). */
export function seriesFor(seedKey: string, total: number, n = 46): number[] {
  const N = n;
  let h = 2166136261;
  for (let i = 0; i < seedKey.length; i++) {
    h ^= seedKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rnd = (i: number) => {
    const x = Math.sin((h % 1000) + i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const trend = 1 + total * Math.pow(t, total > 2 ? 3.1 : 1.15);
    const wobble = 1 + (rnd(i) - 0.5) * Math.min(0.09, 0.02 + Math.abs(total) * 0.05) * Math.sin(t * Math.PI);
    out.push(i === 0 ? 1 : i === N - 1 ? 1 + total : trend * wobble);
  }
  return out;
}

export function polyline(vals: number[], w: number, h: number, pad = 2): string {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals
    .map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
}

export function scalePoints(points: SeriesPoint[], amount: number): number[] {
  return points.map((p) => ((num(p.value) ?? 100) / 100) * amount);
}

export function filterVaults(
  all: Vault[],
  s: {
    search: string;
    watchOnly: boolean;
    watch: string[];
    navFilter: NavKind[];
    hideJunk: boolean;
    full: boolean;
    window: number;
    sort: SortKey;
    dir: "asc" | "desc";
  }
): Vault[] {
  const q = s.search.trim().toLowerCase();
  let list = all.filter((v) => {
    if (s.watchOnly && s.watch.indexOf(v.id) === -1) return false;
    if (s.navFilter.length) {
      if (s.navFilter.indexOf(v.nav) === -1) return false;
    } else if (s.hideJunk && isJunk(v)) return false;
    if (s.full && v.days < (s.window || 90)) return false;
    if (!q) return true;
    return (v.name + " " + v.addr + " " + v.venue).toLowerCase().indexOf(q) !== -1;
  });
  const key = (v: Vault) =>
    ({ alpha: alphaOf(v), ret: v.ret, dd: -v.dd, vol: -v.vol, aum: v.aum || 0, days: v.days }[s.sort as Exclude<SortKey, "name">] ?? 0);
  list = list.slice().sort((a, b) => (s.sort === "name" ? a.name.localeCompare(b.name) : key(b) - key(a)));
  if (s.dir === "asc") list.reverse();
  return list;
}

export const MONO = "var(--font-mono)";
export const DISPLAY = "var(--font-display)";
export const SANS = "var(--font-body)";

export function seg(on: boolean): CSSProperties {
  return {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    border: 0,
    borderRadius: 2,
    padding: "8px 10px",
    cursor: "pointer",
    minHeight: 34,
    color: on ? "#0B0908" : "#AFA290",
    background: on ? "#5FD8C9" : "transparent",
    fontWeight: on ? 600 : 400,
  };
}

export function chip(on: boolean, accent?: string): CSSProperties {
  const tone = accent || "#5FD8C9";
  return {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    borderRadius: 3,
    padding: "9px 11px",
    cursor: "pointer",
    minHeight: 36,
    color: on ? "#0B0908" : "#AFA290",
    background: on ? tone : "transparent",
    border: `1px solid ${on ? tone : "rgba(244,238,226,.18)"}`,
    fontWeight: on ? 600 : 400,
  };
}

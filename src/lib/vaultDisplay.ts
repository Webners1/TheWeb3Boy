/**
 * Display helpers for the youVsBTC dashboard. Visual rules come from
 * E:\design referrence\dashboard-v2-final.dc.html + vault-data.js.
 * Numbers are parsed from the API only at the point of display.
 */

import type { CSSProperties } from "react";
import { formatPct, num, shortName, type Entity, type NavQuality, type SeriesPoint } from "@/lib/vaultbench";

export const WATCH_KEY = "youvsbtc:watchlist:v1";
export const GRID =
  "minmax(190px,2.1fr) minmax(110px,1fr) 100px .82fr .78fr 1.12fr .68fr .68fr .82fr .92fr 92px 88px";
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
    "Time-weighted return over the window. Deposits and withdrawals are stripped out, so a vault can't look good just because money flowed in. Unavailable means the figure was not computed — not a 0% return.",
  ],
  btc: ["BTC return", "Buy-and-hold Bitcoin over exactly the same dates as the vault's coverage."],
  alpha: [
    "Alpha vs BTC",
    "Vault return minus BTC return over the same dates. Positive means you'd have done better here than holding BTC. Null unless both legs exist.",
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
    "Backend values: reported (venue NAV), derived (reconstructed net of flows), roi (money-weighted, never ranked with the others), or unavailable.",
  ],
};

export const NAV_META: Record<NavQuality, { label: string; color: string; note: string }> = {
  reported: { label: "Reported", color: "#5FD8C9", note: "Venue-published per-unit NAV" },
  derived: { label: "Derived", color: "#D8B25F", note: "Reconstructed from account value net of flows" },
  roi: { label: "ROI", color: "#E2793B", note: "Money-weighted only — not ranked against time-weighted NAV" },
};

export type Vault = {
  id: string;
  name: string;
  fullName: string;
  addr: string;
  venue: string;
  source: string;
  kind: string;
  status: string;
  marketType: string | null;
  strategyCategory: string | null;
  externalUrl: string | null;
  aum: number | null;
  ret: number | null;
  btc: number | null;
  eth: number | null;
  sol: number | null;
  beta: number | null;
  vol: number | null;
  dd: number | null;
  days: number | null;
  nav: NavQuality | null;
  headlineEligible: boolean | null;
  hasMetrics: boolean;
  asOf: string | null;
};

export type SortKey = "alpha" | "ret" | "dd" | "vol" | "name";

export const SORT_CHIPS: [SortKey, string][] = [
  ["alpha", "Alpha"],
  ["ret", "Return"],
  ["dd", "Drawdown"],
  ["vol", "Volatility"],
  ["name", "Name"],
];

export const SORT_LABELS: Record<SortKey, string> = {
  alpha: "alpha vs BTC",
  ret: "return",
  dd: "max drawdown",
  vol: "volatility",
  name: "name",
};

export const API_SORT: Record<SortKey, string> = {
  alpha: "alphaBtc",
  ret: "twr",
  dd: "maxDrawdown",
  vol: "volatility",
  name: "name",
};

export function navOf(e: Entity): NavQuality | null {
  const quality = e.metrics?.coverage.navQuality;
  if (quality === "reported" || quality === "derived" || quality === "roi") return quality;
  return null;
}

export function shortAddr(id: string): string {
  if (/^0x[0-9a-f]{40}$/i.test(id)) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  if (id.length > 14) return `${id.slice(0, 4)}…${id.slice(-4)}`;
  return id;
}

export function toVault(e: Entity): Vault {
  const m = e.metrics;
  const dd = num(m?.maxDrawdown);
  return {
    id: e.id,
    name: shortName(e.name),
    fullName: e.name,
    addr: shortAddr(e.externalId),
    venue: e.venue,
    source: e.source,
    kind: e.kind,
    status: e.status,
    marketType: e.marketType,
    strategyCategory: e.strategyCategory,
    externalUrl: e.externalUrl ?? null,
    aum: num(e.aumUsd),
    ret: num(m?.twr),
    btc: num(m?.benchTwrBtc),
    eth: num(m?.benchTwrEth),
    sol: num(m?.benchTwrSol),
    beta: num(m?.betaBtc),
    vol: num(m?.volatility),
    dd: dd === null ? null : Math.abs(dd),
    days: m?.coverage.daysCovered ?? null,
    nav: navOf(e),
    headlineEligible: m?.coverage.headlineEligible ?? null,
    hasMetrics: m !== null,
    asOf: m?.asOf ?? e.aumAsOf,
  };
}

export function alphaOf(v: Pick<Vault, "ret" | "btc">): number | null {
  if (v.ret === null || v.btc === null) return null;
  return v.ret - v.btc;
}

export function canCompare(v: Pick<Vault, "hasMetrics" | "ret" | "btc">): boolean {
  return v.hasMetrics && v.ret !== null && v.btc !== null;
}

export function metricLabel(value: string | number | null | undefined, fallback = "Unavailable"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function tone(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "#AFA290";
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
export function seriesFor(seedKey: string, total: number | null, n = 46): number[] | null {
  if (total === null || !Number.isFinite(total)) return null;
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
  const toneColor = accent || "#5FD8C9";
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
    background: on ? toneColor : "transparent",
    border: `1px solid ${on ? toneColor : "rgba(244,238,226,.18)"}`,
    fontWeight: on ? 600 : 400,
  };
}

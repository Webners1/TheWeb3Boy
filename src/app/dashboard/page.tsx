"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import CompareChart, { type ChartSeries } from "@/components/CompareChart";
import {
  API_BASE,
  SORTS,
  WINDOWS,
  compare,
  formatMoney,
  formatPct,
  listEntities,
  num,
  shortName,
  type Entity,
} from "@/lib/vaultbench";

const BENCH_COLORS: Record<string, string> = {
  BTC: "#E2793B",
  ETH: "#8C7BE8",
  SOL: "#C7A34F",
};
const ENTITY_COLOR = "#5FD8C9";
const AMOUNT_PRESETS = [100, 1000, 10000, 100000];

export default function Dashboard() {
  // filters
  const [windowDays, setWindowDays] = useState<number>(90);
  const [sort, setSort] = useState<string>("alphaBtc");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [status, setStatus] = useState<string>("");
  const [fullWindow, setFullWindow] = useState(true);
  const [hideOutliers, setHideOutliers] = useState(true);
  const [search, setSearch] = useState("");

  // amount
  const [amount, setAmount] = useState<number>(1000);

  const [selected, setSelected] = useState<Entity | null>(null);
  const [benches, setBenches] = useState<string[]>(["BTC"]);

  // SWR handles the loading/error/race bookkeeping. Keying on the filter
  // values means switching window or sort refetches, and switching back is
  // served from cache.
  const listKey = ["entities", windowDays, sort, direction, status, fullWindow] as const;
  const {
    data: listData,
    error: listErr,
    isLoading: listLoading,
  } = useSWR(listKey, () =>
    listEntities({
      window: windowDays,
      sort,
      direction,
      status: status || undefined,
      fullWindow,
      limit: 100,
    })
  );

  const {
    data: cmp,
    error: cmpErr,
    isLoading: cmpLoading,
  } = useSWR(
    selected ? (["compare", selected.id, benches.join(","), windowDays] as const) : null,
    () => compare(selected!.id, benches.join(",") || "BTC", windowDays)
  );

  const entities: Entity[] = useMemo(() => listData?.entities ?? [], [listData]);
  const total = listData?.pagination.total ?? 0;
  const listError = listErr instanceof Error ? listErr.message : null;
  const cmpError = cmpErr instanceof Error ? cmpErr.message : null;

  // A handful of Enzyme vaults report NAV series that produce returns in the
  // millions of percent and betas in the thousands. Those are upstream data
  // artifacts, not performance, and they otherwise dominate an alpha ranking.
  // Filtered here rather than hidden: the count is reported below the table.
  const isArtifact = useCallback((e: Entity) => {
    const twr = num(e.metrics?.twr);
    const beta = num(e.metrics?.betaBtc);
    return (twr !== null && Math.abs(twr) > 10) || (beta !== null && Math.abs(beta) > 50);
  }, []);

  const { visible, hiddenCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = q
      ? entities.filter((e) => e.name.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q))
      : entities;
    if (!hideOutliers) return { visible: searched, hiddenCount: 0 };
    const kept = searched.filter((e) => !isArtifact(e));
    return { visible: kept, hiddenCount: searched.length - kept.length };
  }, [entities, search, hideOutliers, isArtifact]);

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!cmp) return [];
    const out: ChartSeries[] = [
      { key: "entity", label: selected ? shortName(selected.name) : "Vault", color: ENTITY_COLOR, points: cmp.entity },
    ];
    for (const [k, pts] of Object.entries(cmp.benchmarks)) {
      out.push({ key: k, label: k, color: BENCH_COLORS[k] ?? "#AFA290", points: pts });
    }
    return out;
  }, [cmp, selected]);

  // "What your money did": final indexed value scaled by the amount.
  const outcome = useMemo(() => {
    if (!cmp) return null;
    const endOf = (pts: { value: string }[]) => {
      const v = num(pts[pts.length - 1]?.value);
      return v === null ? null : (v / 100) * amount;
    };
    const vault = endOf(cmp.entity);
    const btc = cmp.benchmarks.BTC ? endOf(cmp.benchmarks.BTC) : null;
    return { vault, btc, diff: vault !== null && btc !== null ? vault - btc : null };
  }, [cmp, amount]);

  return (
    <div className="dash">
      <div className="grain" aria-hidden="true" />

      <header className="dash-header">
        <Link href="/" className="brand">
          <span className="pulse-dot" />
          theweb3boy
        </Link>
        <Link href="/#tools" className="dash-back">
          ← Back to site
        </Link>
      </header>

      <main className="dash-body">
        <p className="dash-eyebrow">Tools · youVsBTC</p>
        <h1 className="dash-title">Would you have been better off just buying Bitcoin?</h1>
        <p className="dash-note">
          Pick a vault, pick an amount, and see what that money would have done in the vault versus buy-and-hold
          BTC over the same window. Returns are time-weighted with deposits and withdrawals removed, so a vault
          can&apos;t look good just because money flowed in.
        </p>

        {/* ---- controls ---- */}
        <section className="controls" aria-label="Filters">
          <div className="control">
            <label className="control-label" htmlFor="amount">
              If I had invested
            </label>
            <div className="amount-row">
              <input
                id="amount"
                className="amount-input"
                type="number"
                min={1}
                step={100}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
              />
              {AMOUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip ${amount === p ? "chip-on" : ""}`}
                  onClick={() => setAmount(p)}
                >
                  {formatMoney(p)}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <span className="control-label">Window</span>
            <div className="chip-row">
              {WINDOWS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  className={`chip ${windowDays === w.value ? "chip-on" : ""}`}
                  onClick={() => setWindowDays(w.value)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <span className="control-label">Benchmarks</span>
            <div className="chip-row">
              {(["BTC", "ETH", "SOL"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`chip ${benches.includes(b) ? "chip-on" : ""}`}
                  onClick={() =>
                    setBenches((prev) =>
                      prev.includes(b) ? (prev.length > 1 ? prev.filter((x) => x !== b) : prev) : [...prev, b]
                    )
                  }
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <label className="control-label" htmlFor="sort">
              Rank by
            </label>
            <div className="chip-row">
              <select id="sort" className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="chip"
                onClick={() => setDirection((d) => (d === "desc" ? "asc" : "desc"))}
                aria-label="Toggle sort direction"
              >
                {direction === "desc" ? "High → low" : "Low → high"}
              </button>
            </div>
          </div>

          <div className="control">
            <label className="control-label" htmlFor="status">
              Status
            </label>
            <div className="chip-row">
              <select id="status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
              <button
                type="button"
                className={`chip ${fullWindow ? "chip-on" : ""}`}
                onClick={() => setFullWindow((v) => !v)}
                title="Only vaults with data covering the whole window"
              >
                Full window only
              </button>
              <button
                type="button"
                className={`chip ${hideOutliers ? "chip-on" : ""}`}
                onClick={() => setHideOutliers((v) => !v)}
                title="Hide vaults whose reported return exceeds ±1000% or beta exceeds ±50 — upstream NAV artifacts, not performance"
              >
                Hide data artifacts
              </button>
            </div>
          </div>

          <div className="control control-grow">
            <label className="control-label" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              className="search-input"
              placeholder="Vault address or venue"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </section>

        {/* ---- comparison ---- */}
        {selected && (
          <section className="compare-panel" aria-label="Comparison">
            <div className="compare-head">
              <div>
                <p className="compare-eyebrow">
                  {shortName(selected.name)} · {selected.venue}
                </p>
                <h2 className="compare-title">
                  {outcome?.vault !== null && outcome?.vault !== undefined ? formatMoney(outcome.vault) : "—"}{" "}
                  <span className="vs">vs</span>{" "}
                  <span className="btc">
                    {outcome?.btc !== null && outcome?.btc !== undefined ? formatMoney(outcome.btc) : "—"} in BTC
                  </span>
                </h2>
                {outcome?.diff !== null && outcome?.diff !== undefined && (
                  <p className={`compare-verdict ${outcome.diff >= 0 ? "good" : "bad"}`}>
                    {outcome.diff >= 0
                      ? `Beat Bitcoin by ${formatMoney(Math.abs(outcome.diff))}`
                      : `Behind Bitcoin by ${formatMoney(Math.abs(outcome.diff))}`}{" "}
                    on {formatMoney(amount)} over {cmp ? `${cmp.startAsOf} → ${cmp.endAsOf}` : "this window"}
                  </p>
                )}
              </div>
              <button type="button" className="chip" onClick={() => setSelected(null)}>
                Clear
              </button>
            </div>

            {cmpLoading && <p className="dash-note">Loading comparison…</p>}
            {cmpError && <p className="error-note">Comparison failed: {cmpError}</p>}

            {cmp && !cmpLoading && (
              <>
                <CompareChart series={chartSeries} amount={amount} />
                <div className="legend-row">
                  {chartSeries.map((s) => (
                    <span key={s.key} className="legend-item">
                      <i className="dot" style={{ background: s.color }} />
                      {s.label}
                    </span>
                  ))}
                </div>

                <div className="coverage-row">
                  <span className={`pill ${cmp.coverage.isFullWindow ? "up" : "down"}`}>
                    {cmp.coverage.daysCovered}d covered
                    {cmp.coverage.isFullWindow ? "" : " · partial window"}
                  </span>
                  <span className={`pill ${cmp.coverage.sampling === "daily" ? "up" : "down"}`}>
                    {cmp.coverage.sampling}
                  </span>
                  <span className="pill">nav: {cmp.coverage.navQuality}</span>
                  {!cmp.coverage.headlineEligible && <span className="pill down">not headline eligible</span>}
                  {cmp.coverage.feesApplied && <span className="pill">fees applied</span>}
                </div>
                <p className="api-note">{cmp.note}</p>
              </>
            )}
          </section>
        )}

        {/* ---- vault list ---- */}
        <h2 className="dash-section-title">
          {listLoading ? "Loading vaults…" : `${visible.length} of ${total} vaults`}
          <span className="window-tag">{WINDOWS.find((w) => w.value === windowDays)?.label} window</span>
        </h2>

        {listError && (
          <p className="error-note">
            Couldn&apos;t reach the API ({listError}). Base URL: <code>{API_BASE}</code>
          </p>
        )}

        {hiddenCount > 0 && (
          <p className="api-note">
            {hiddenCount} vault{hiddenCount === 1 ? "" : "s"} hidden: reported return above ±1000% or beta above
            ±50. In this dataset those come from upstream NAV artifacts rather than performance. Turn off
            &ldquo;Hide data artifacts&rdquo; to see them.
          </p>
        )}

        <div className="table-wrap">
          <table className="vault-table">
            <thead>
              <tr>
                <th>Vault</th>
                <th>Venue</th>
                <th style={{ textAlign: "right" }}>Return</th>
                <th style={{ textAlign: "right" }}>BTC</th>
                <th style={{ textAlign: "right" }}>Alpha vs BTC</th>
                <th style={{ textAlign: "right" }}>Beta</th>
                <th style={{ textAlign: "right" }}>Max DD</th>
                <th>Coverage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const m = e.metrics;
                const alpha = num(m?.alphaBtc);
                return (
                  <tr
                    key={e.id}
                    className={selected?.id === e.id ? "row-selected" : ""}
                    onClick={() => setSelected(e)}
                  >
                    <td className="name">{shortName(e.name)}</td>
                    <td>{e.venue}</td>
                    <td className="num">{formatPct(m?.twr)}</td>
                    <td className="num">{formatPct(m?.benchTwrBtc)}</td>
                    <td className={`num ${alpha !== null && alpha >= 0 ? "pos" : "neg"}`}>
                      {formatPct(m?.alphaBtc)}
                    </td>
                    <td className="num">{m?.betaBtc ? Number(m.betaBtc).toFixed(2) : "—"}</td>
                    <td className="num">{formatPct(m?.maxDrawdown)}</td>
                    <td>
                      <span className={`pill ${m?.coverage.isFullWindow ? "up" : "down"}`}>
                        {m ? `${m.coverage.daysCovered}d` : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="row-cta">Compare →</span>
                    </td>
                  </tr>
                );
              })}
              {!listLoading && !visible.length && !listError && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    No vaults match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="dash-note" style={{ marginTop: 28 }}>
          Live data from the youVsBTC API at <code>{API_BASE}</code>. Returns and ratios are exact decimals
          server-side and are parsed here only for display.{" "}
          <a
            href="https://github.com/Webners1/youVsBtc"
            target="_blank"
            rel="noopener"
            style={{ color: "var(--teal)", borderBottom: "1px solid rgba(95,216,201,0.35)" }}
          >
            Source on GitHub
          </a>
        </p>
      </main>
    </div>
  );
}

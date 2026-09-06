"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useParams } from "next/navigation";
import ExternalVenueLink from "@/components/ExternalVenueLink";
import { VenueMarks, venueProtocolLabel } from "@/components/VenueBadge";
import {
  API_BASE,
  compare,
  formatPct,
  getEntity,
  getFollowers,
  getSeries,
  metricDefinitions,
  num,
} from "@/lib/vaultbench";
import { DISPLAY, MONO, NAV_META, SANS, money, pct, shortDate } from "@/lib/vaultDisplay";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#6F6455" }}>
        {label}
      </span>
      <span style={{ fontFamily: SANS, fontSize: 14, color: "#F4EEE2", overflowWrap: "anywhere" }}>
        {value === null || value === undefined || value === "" ? "Unavailable" : String(value)}
      </span>
    </div>
  );
}

export default function VaultDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const {
    data: entity,
    error: entityErr,
    isLoading,
  } = useSWR(id ? ["entity", id] : null, () => getEntity(id));
  const { data: series, error: seriesErr } = useSWR(id ? ["series", id] : null, () => getSeries(id));
  const { data: followers, error: followersErr } = useSWR(id ? ["followers", id] : null, () => getFollowers(id));
  const { data: defs } = useSWR("metric-definitions", metricDefinitions);
  const window = entity?.metrics.find((row) => row.coverage.windowDays === 90)?.coverage.windowDays
    ?? entity?.metrics[0]?.coverage.windowDays
    ?? 90;
  const { data: cmp, error: cmpErr } = useSWR(
    id && entity ? ["compare-detail", id, window] : null,
    () => compare(id, "BTC,ETH,SOL", window),
  );

  const error = entityErr instanceof Error ? entityErr.message : null;
  const missing = error?.startsWith("not_found") || error?.includes("404");

  const sortedMetrics = useMemo(
    () => [...(entity?.metrics ?? [])].sort((a, b) => a.coverage.windowDays - b.coverage.windowDays),
    [entity],
  );

  return (
    <main
      className="yv-dash"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(120% 70% at 8% -8%, #16110D 0%, #0B0908 52%)",
        padding: "clamp(20px,4vw,48px) clamp(14px,3vw,40px) 80px",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link href="/dashboard" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#5FD8C9" }}>
          ← Back to dashboard
        </Link>
        {isLoading && (
          <p style={{ fontFamily: MONO, fontSize: 13, color: "#AFA290", marginTop: 28 }}>Loading vault…</p>
        )}
        {missing && (
          <p style={{ fontFamily: SANS, fontSize: 15, color: "#FF9A56", marginTop: 28 }}>
            This entity ID is not in the archive.
          </p>
        )}
        {error && !missing && (
          <p style={{ fontFamily: MONO, fontSize: 13, color: "#FF9A56", marginTop: 28 }}>
            Couldn&apos;t reach the API ({error}). Base URL: <code>{API_BASE}</code>
          </p>
        )}
        {entity && (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 22 }}>
              <VenueMarks venue={entity.venue} protoSize={28} />
              <div style={{ minWidth: 0 }}>
                <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(1.6rem,3.4vw,2.6rem)", fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
                  {entity.name}
                </h1>
                <p style={{ fontFamily: MONO, fontSize: 12, color: "#AFA290", margin: "8px 0 0" }}>
                  {venueProtocolLabel(entity.venue)} · {entity.externalId}
                </p>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <ExternalVenueLink href={entity.externalUrl} venue={entity.venue} source={entity.source} />
            </div>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginTop: 28 }}>
              <Field label="Venue" value={entity.venue} />
              <Field label="Source" value={entity.source} />
              <Field label="Status" value={entity.status} />
              <Field label="Kind" value={entity.kind} />
              <Field label="Market type" value={entity.marketType} />
              <Field label="Strategy" value={entity.strategyCategory} />
              <Field label="Base currency" value={entity.baseCurrency} />
              <Field label="Inception" value={entity.inceptionDate} />
              <Field label="First observed" value={entity.firstSeenAt} />
              <Field label="Last observed" value={entity.lastSeenAt} />
              <Field label="AUM" value={entity.aumUsd === null ? null : money(num(entity.aumUsd))} />
              <Field label="AUM as of" value={entity.aumAsOf} />
              <Field label="Provenance" value={entity.provenance} />
              <Field label="Copy mode" value={entity.copyMode} />
              <Field label="Positions visible" value={entity.positionsVisible === null ? null : String(entity.positionsVisible)} />
              <Field label="Manager stake" value={entity.managerStakeRatio} />
              <Field label="Pending redemptions" value={entity.pendingRedemptionsUsd === null ? null : money(num(entity.pendingRedemptionsUsd))} />
              <Field label="Fee coverage" value={entity.fees.status} />
            </section>

            <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Fees</h2>
            <p style={{ fontFamily: SANS, fontSize: 13.5, color: "#AFA290", margin: "0 0 12px" }}>
              {entity.fees.note ?? "Fee terms travel with their coverage. Missing is not zero."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
              {(["managementFee", "performanceFee", "leaderCommission", "streamingFee", "entryFee", "exitFee"] as const).map((key) => (
                <Field
                  key={key}
                  label={key}
                  value={
                    entity.fees[key].value === null
                      ? entity.fees[key].status
                      : `${entity.fees[key].value} (${entity.fees[key].status})`
                  }
                />
              ))}
            </div>

            <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Metrics by window</h2>
            {sortedMetrics.length === 0 ? (
              <p style={{ fontFamily: SANS, color: "#AFA290" }}>Performance unavailable — no metrics have been computed for this entity.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {sortedMetrics.map((row) => {
                  const nav = row.coverage.navQuality ? NAV_META[row.coverage.navQuality] : null;
                  return (
                    <article key={row.coverage.windowDays} style={{ border: "1px solid rgba(244,238,226,.12)", borderRadius: 4, padding: 16 }}>
                      <h3 style={{ fontFamily: MONO, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", margin: "0 0 12px", color: "#5FD8C9" }}>
                        {row.coverage.windowDays === 0 ? "Since inception" : `${row.coverage.windowDays}-day window`} · as of {row.asOf}
                      </h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
                        <Field label="Return" value={formatPct(row.twr)} />
                        <Field label="BTC" value={formatPct(row.benchTwrBtc)} />
                        <Field label="ETH" value={formatPct(row.benchTwrEth)} />
                        <Field label="SOL" value={formatPct(row.benchTwrSol)} />
                        <Field label="Alpha BTC" value={formatPct(row.alphaBtc)} />
                        <Field label="Beta BTC" value={row.betaBtc} />
                        <Field label="Vol" value={formatPct(row.volatility)} />
                        <Field label="Max DD" value={formatPct(row.maxDrawdown)} />
                        <Field label="Days covered" value={row.coverage.daysCovered} />
                        <Field label="Full window" value={String(row.coverage.isFullWindow)} />
                        <Field label="NAV quality" value={nav?.label ?? "Unavailable"} />
                        <Field label="Headline eligible" value={String(row.coverage.headlineEligible)} />
                        <Field label="Fees applied" value={String(row.coverage.feesApplied)} />
                        <Field label="BTC bench" value={row.coverage.benchmarks.btc} />
                        <Field label="ETH bench" value={row.coverage.benchmarks.eth} />
                        <Field label="SOL bench" value={row.coverage.benchmarks.sol} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Time series</h2>
            {seriesErr instanceof Error ? (
              <p style={{ color: "#FF9A56" }}>Series unavailable ({seriesErr.message}).</p>
            ) : !series || series.points.length === 0 ? (
              <p style={{ color: "#AFA290" }}>No NAV series is published for this entity.</p>
            ) : (
              <p style={{ fontFamily: MONO, fontSize: 12, color: "#AFA290" }}>
                {series.points.length} NAV points
                {series.points[0] ? ` from ${shortDate(series.points[0].asOf)}` : ""}
                {series.points[series.points.length - 1] ? ` to ${shortDate(series.points[series.points.length - 1]!.asOf)}` : ""}
                . Flows removed: {series.flows.length === 0 ? "none recorded" : `${series.flows.length} points`}.
              </p>
            )}

            <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Benchmark comparison</h2>
            {cmpErr instanceof Error ? (
              <p style={{ color: "#FF9A56" }}>Comparison unavailable ({cmpErr.message}).</p>
            ) : !cmp || cmp.entity.length === 0 ? (
              <p style={{ color: "#AFA290" }}>Comparison unavailable for this window.</p>
            ) : (
              <div>
                <p style={{ fontFamily: SANS, fontSize: 13.5, color: "#AFA290", maxWidth: 720 }}>{cmp.note}</p>
                <p style={{ fontFamily: MONO, fontSize: 12, color: "#AFA290" }}>
                  {cmp.startAsOf} → {cmp.endAsOf} · entity points {cmp.entity.length}
                  {(["BTC", "ETH", "SOL"] as const).map((sym) => {
                    const points = cmp.benchmarks[sym];
                    return ` · ${sym} ${points && points.length > 0 ? `${points.length} pts` : "unavailable"}`;
                  })}
                </p>
              </div>
            )}

            <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Followers</h2>
            {followersErr instanceof Error ? (
              <p style={{ color: "#FF9A56" }}>Followers unavailable ({followersErr.message}).</p>
            ) : !followers || followers.coverage.status === "unavailable" ? (
              <p style={{ color: "#AFA290" }}>No follower cross-section has been captured.</p>
            ) : (
              <div>
                <p style={{ fontFamily: MONO, fontSize: 12, color: followers.coverage.status === "stale" ? "#D8B25F" : "#AFA290" }}>
                  {followers.coverage.status}
                  {followers.coverage.lagDays !== null ? ` · ${followers.coverage.lagDays}d lag` : ""}
                  {followers.asOf ? ` · as of ${followers.asOf}` : ""} · {followers.count} depositors
                </p>
                <p style={{ fontFamily: SANS, fontSize: 13.5, color: "#AFA290", maxWidth: 720 }}>{followers.note}</p>
                <p style={{ fontFamily: MONO, fontSize: 12, color: "#AFA290" }}>
                  Median {pct(num(followers.medianReturn))} · p25 {pct(num(followers.p25Return))} · p75 {pct(num(followers.p75Return))}
                </p>
              </div>
            )}

            {defs && (
              <>
                <h2 style={{ fontFamily: DISPLAY, fontSize: "1.15rem", margin: "36px 0 12px" }}>Metric definitions</h2>
                <ul style={{ padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {defs.definitions.map((row) => (
                    <li key={row.key} style={{ borderTop: "1px solid rgba(244,238,226,.08)", paddingTop: 10 }}>
                      <strong style={{ fontFamily: MONO, fontSize: 12, color: "#5FD8C9" }}>{row.label}</strong>
                      <p style={{ fontFamily: SANS, fontSize: 13, color: "#AFA290", margin: "4px 0 0" }}>{row.description}</p>
                      {row.caveats ? (
                        <p style={{ fontFamily: SANS, fontSize: 12.5, color: "#6F6455", margin: "4px 0 0" }}>{row.caveats}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

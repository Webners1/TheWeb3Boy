"use client";

import { useEffect } from "react";
import Link from "next/link";
import { initDuelChart } from "@/lib/duelChart";

type SampleVault = {
  name: string;
  source: "Hyperliquid" | "OKX";
  ret30d: number;
  vsBtc: number;
};

const SAMPLE_VAULTS: SampleVault[] = [
  { name: "NorthStar Alpha", source: "Hyperliquid", ret30d: 24.8, vsBtc: 16.1 },
  { name: "Enzyme Delta-Neutral", source: "Hyperliquid", ret30d: 11.2, vsBtc: 2.5 },
  { name: "leadtrader_kx", source: "OKX", ret30d: -3.4, vsBtc: -12.1 },
  { name: "HL Momentum 3x", source: "Hyperliquid", ret30d: 41.6, vsBtc: 32.9 },
  { name: "swing_king88", source: "OKX", ret30d: 6.1, vsBtc: -2.6 },
  { name: "Quiet Carry Vault", source: "Hyperliquid", ret30d: 9.4, vsBtc: 0.7 },
];

export default function Dashboard() {
  useEffect(() => {
    const cleanup = initDuelChart();
    return cleanup;
  }, []);

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
        <h1 className="dash-title">Every vault, checked against just holding Bitcoin.</h1>
        <p className="dash-note">
          youVsBTC tracks Hyperliquid and OKX vaults daily, computes flow-neutral NAV so deposits and withdrawals
          can&apos;t fake the number, and lines every vault up against Bitcoin, Ethereum, and Solana.
        </p>
        <div>
          <span className="sample-banner">Sample data — live feed connects here once youVsBTC ships</span>
        </div>

        <div className="stat-row">
          <div className="stat-tile">
            <div className="stat-label">Vaults tracked</div>
            <div className="stat-value">1,204</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Median vs BTC (30d)</div>
            <div className="stat-value neg">-1.8%</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Best vs BTC (30d)</div>
            <div className="stat-value pos">+32.9%</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Vaults beating BTC</div>
            <div className="stat-value">38%</div>
          </div>
        </div>

        <h2 className="dash-section-title">YOU vs BTC, sample vault</h2>
        <div className="tool-preview">
          <canvas id="duelCanvas" aria-hidden="true" />
          <div className="duel-legend">
            <span className="legend-item">
              <i className="dot t" />
              YOU <b>+21.4%</b>
            </span>
            <span className="legend-item">
              <i className="dot c" />
              BTC <b>+8.7%</b>
            </span>
          </div>
          <p className="duel-caption">Sample chart. Not real numbers yet.</p>
        </div>

        <h2 className="dash-section-title" style={{ marginTop: 56 }}>
          Sample vault feed
        </h2>
        <div className="table-wrap">
          <table className="vault-table">
            <thead>
              <tr>
                <th>Vault</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>30d return</th>
                <th style={{ textAlign: "right" }}>vs BTC</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_VAULTS.map((v) => (
                <tr key={v.name}>
                  <td className="name">{v.name}</td>
                  <td>{v.source}</td>
                  <td className="num">
                    {v.ret30d > 0 ? "+" : ""}
                    {v.ret30d.toFixed(1)}%
                  </td>
                  <td className="num">
                    {v.vsBtc > 0 ? "+" : ""}
                    {v.vsBtc.toFixed(1)}%
                  </td>
                  <td>
                    <span className={`pill ${v.vsBtc >= 0 ? "up" : "down"}`}>
                      {v.vsBtc >= 0 ? "beating btc" : "trailing btc"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="dash-note" style={{ marginBottom: 0 }}>
          Building this in public.{" "}
          <a
            href="https://github.com/Webners1/youVsBtc"
            target="_blank"
            rel="noopener"
            style={{ color: "var(--teal)", borderBottom: "1px solid rgba(95,216,201,0.35)" }}
          >
            Follow progress on GitHub
          </a>{" "}
          or{" "}
          <a
            href="mailto:muzammilsiddiqui001@gmail.com"
            style={{ color: "var(--teal)", borderBottom: "1px solid rgba(95,216,201,0.35)" }}
          >
            reach out
          </a>{" "}
          if you want early access.
        </p>
      </main>
    </div>
  );
}

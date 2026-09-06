"use client";

import { useMemo, useState } from "react";
import { MONO, money, shortDate } from "@/lib/vaultDisplay";

export type ChartLine = {
  key: string;
  label: string;
  color: string;
  weight: number;
  opacity: number;
  isBench: boolean;
  values: number[];
};

type Props = {
  lines: ChartLine[];
  dates: string[];
  amount: number;
  windowDays: number;
};

const N_FALLBACK = 46;
const W = 882;
const H = 258;
const TOP = 14;

export default function DuelChart({ lines, dates, amount, windowDays }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    const live = lines.filter((s) => s.values.length > 1);
    if (!live.length) return null;
    const n = live[0].values.length;
    const axis = dates.length === n ? dates : dates.slice(0, n);
    const flat = live.flatMap((s) => s.values).concat([amount]);
    let lo = Math.min(...flat);
    let hi = Math.max(...flat);
    const pd = (hi - lo) * 0.1 || amount * 0.1;
    lo -= pd;
    hi += pd;
    const X = (i: number) => 64 + (i / (n - 1)) * (W - 74);
    const Y = (v: number) => TOP + (1 - (v - lo) / (hi - lo)) * H;
    const ticks = [0, 0.33, 0.66, 1].map((f) => {
      const val = lo + (hi - lo) * (1 - f);
      return { y: Y(val), ty: Y(val) - 5, label: money(val, { compact: true }) };
    });
    return { live, n, axis, lo, hi, X, Y, ticks };
  }, [lines, dates, amount]);

  if (!model) return null;

  const { live, n, axis, X, Y, ticks } = model;
  const last = n - 1;
  const span = windowDays || 90;
  const hovering = hoverIdx !== null;
  const hi = hoverIdx;

  return (
    <div className="yv-chart-wrap">
      <svg
        viewBox="0 0 960 300"
        role="img"
        aria-label="Value over time, challenger versus benchmarks"
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1="0" x2="882" y1={t.y} y2={t.y} stroke="rgba(244,238,226,.06)" strokeWidth="1" />
            <text x="0" y={t.ty} fill="#6F6455" style={{ fontFamily: MONO, fontSize: 12 }}>
              {t.label}
            </text>
          </g>
        ))}
        <line
          x1="0"
          x2="882"
          y1={Y(amount)}
          y2={Y(amount)}
          stroke="rgba(244,238,226,.24)"
          strokeWidth="1"
          strokeDasharray="3 6"
        />
        {live.map((s) => (
          <g key={s.key}>
            <polyline
              points={s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={s.weight}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={s.opacity}
            />
            <circle cx={X(last)} cy={Y(s.values[last]!)} r="4.5" fill={s.color} />
            <text
              className="yv-chart-end"
              x={X(last) + 8}
              y={Y(s.values[last]!) + 4}
              fill={s.color}
              style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500 }}
            >
              {money(s.values[last], { compact: true })}
            </text>
          </g>
        ))}
        {hovering && hi !== null && (
          <g>
            <line x1={X(hi)} x2={X(hi)} y1="10" y2="272" stroke="rgba(244,238,226,.35)" strokeWidth="1" />
            {live.map((s) => (
              <circle
                key={s.key}
                cx={X(hi)}
                cy={Y(s.values[hi]!)}
                r="4"
                fill={s.color}
                stroke="#0B0908"
                strokeWidth="1.5"
              />
            ))}
          </g>
        )}
        <text x="0" y="296" fill="#6F6455" style={{ fontFamily: MONO, fontSize: 12 }}>
          {axis[0]}
        </text>
        <text x="882" y="296" textAnchor="end" fill="#6F6455" style={{ fontFamily: MONO, fontSize: 12 }}>
          {axis[last] ?? axis[axis.length - 1]}
        </text>
        <rect
          x="60"
          y="6"
          width="826"
          height="280"
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - r.left) / r.width) * 826 + 60;
            const idx = Math.max(0, Math.min(n - 1, Math.round(((svgX - 64) / (W - 74)) * (n - 1))));
            if (idx !== hoverIdx) setHoverIdx(idx);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        />
      </svg>
      {hovering && hi !== null && (
        <div
          style={{
            position: "absolute",
            top: 6,
            ...(hi / (n - 1) > 0.55 ? { left: 4 } : { right: 4 }),
            minWidth: 186,
            padding: "10px 12px",
            border: "1px solid rgba(244,238,226,.18)",
            borderRadius: 3,
            background: "rgba(11,9,8,.96)",
            pointerEvents: "none",
            boxShadow: "0 14px 30px rgba(0,0,0,.5)",
          }}
        >
          <span
            style={{
              display: "block",
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "#6F6455",
              marginBottom: 7,
            }}
          >
            {shortDate(axis[hi] ?? "")} · day {hi === 0 ? 0 : Math.round((hi / (n - 1)) * span)}
          </span>
          {live.map((s) => (
            <span
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                fontFamily: MONO,
                fontSize: 11.5,
                padding: "2px 0",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, color: "#AFA290" }}>
                <i
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flex: "none",
                    display: "inline-block",
                    background: s.color,
                  }}
                />
                {s.label}
              </span>
              <span style={{ color: "#F4EEE2", fontVariantNumeric: "tabular-nums" }}>{money(s.values[hi])}</span>
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          marginTop: 10,
          fontFamily: MONO,
          fontSize: 11.5,
          color: "#AFA290",
        }}
      >
        {live.map((s) => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: s.isBench ? 1 : "50%",
                flex: "none",
                display: "inline-block",
                background: s.color,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export { N_FALLBACK };

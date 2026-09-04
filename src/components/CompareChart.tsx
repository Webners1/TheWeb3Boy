"use client";

import { useMemo, useState } from "react";
import type { SeriesPoint } from "@/lib/vaultbench";
import { formatMoney, num } from "@/lib/vaultbench";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  points: SeriesPoint[];
};

type Props = {
  /** Every series is indexed to 100 at the shared start date. */
  series: ChartSeries[];
  /** What the viewer says they'd have put in, in USD. */
  amount: number;
  height?: number;
};

const PAD = { top: 18, right: 84, bottom: 28, left: 62 };
const VIEW_W = 960;

export default function CompareChart({ series, amount, height = 320 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const viewH = height;

  const model = useMemo(() => {
    const live = series.filter((s) => s.points.length > 1);
    if (!live.length) return null;

    // All series share the same dates (the API indexes them to a common start).
    const dates = live[0].points.map((p) => p.asOf);
    const scaled = live.map((s) => ({
      ...s,
      values: s.points.map((p) => ((num(p.value) ?? 100) / 100) * amount),
    }));

    const all = scaled.flatMap((s) => s.values);
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const headroom = (max - min) * 0.08;
    min -= headroom;
    max += headroom;

    const plotW = VIEW_W - PAD.left - PAD.right;
    const plotH = viewH - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (dates.length - 1)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

    // Ticks are real values the chart actually reaches.
    const ticks = [min + headroom, (min + max) / 2, max - headroom];

    return { dates, scaled, min, max, x, y, plotW, plotH, ticks };
  }, [series, amount, viewH]);

  if (!model) {
    return <p className="chart-empty">Not enough overlapping history to draw a comparison.</p>;
  }

  const { dates, scaled, x, y, ticks } = model;
  const lastIdx = dates.length - 1;
  const activeIdx = hoverIdx ?? lastIdx;

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        className="chart-svg"
        role="img"
        aria-label={`Value of ${formatMoney(amount)} over time, vault versus benchmarks`}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * VIEW_W;
          const t = (px - PAD.left) / (VIEW_W - PAD.left - PAD.right);
          const i = Math.round(t * lastIdx);
          setHoverIdx(Math.min(Math.max(i, 0), lastIdx));
        }}
      >
        {/* horizontal grid + value axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="chart-axis-text">
              {formatMoney(t)}
            </text>
          </g>
        ))}

        {/* start / end date labels */}
        <text x={PAD.left} y={viewH - 8} className="chart-axis-text">
          {dates[0]}
        </text>
        <text x={VIEW_W - PAD.right} y={viewH - 8} textAnchor="end" className="chart-axis-text">
          {dates[lastIdx]}
        </text>

        {/* the invested-amount baseline */}
        <line
          x1={PAD.left}
          x2={VIEW_W - PAD.right}
          y1={y(amount)}
          y2={y(amount)}
          className="chart-baseline"
        />

        {scaled.map((s) => (
          <path
            key={s.key}
            d={s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* hover readout */}
        <line
          x1={x(activeIdx)}
          x2={x(activeIdx)}
          y1={PAD.top}
          y2={viewH - PAD.bottom}
          className="chart-cursor"
        />
        {scaled.map((s) => (
          <g key={`${s.key}-dot`}>
            <circle cx={x(activeIdx)} cy={y(s.values[activeIdx])} r={4} fill={s.color} />
            <text
              x={VIEW_W - PAD.right + 8}
              y={y(s.values[activeIdx]) + 4}
              className="chart-value-text"
              fill={s.color}
            >
              {formatMoney(s.values[activeIdx])}
            </text>
          </g>
        ))}
      </svg>

      <p className="chart-hover-date">
        {hoverIdx === null ? `Latest: ${dates[lastIdx]}` : dates[activeIdx]}
      </p>
    </div>
  );
}

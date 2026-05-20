import { useState } from "react";

export type LineChartPoint = { date: string; value: number };

const VW = 480;
const PAD = { top: 20, right: 32, bottom: 48 };

const AXIS_FONT_SIZE = 22;
const Y_LABEL_GAP = 30;
const CHAR_WIDTH = AXIS_FONT_SIZE * 0.62;

const BORDER_COLOR = "hsl(var(--border))";
const MUTED_COLOR = "hsl(var(--muted-foreground))";
const CARD_COLOR = "hsl(var(--card))";
const LINE_COLOR = "#3b82f6";

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const raw = range / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].find((n) => n * mag >= raw) ?? 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t < max + step; t += step) {
    ticks.push(Math.round(t * 1000) / 1000);
  }
  return ticks;
}

function fmtXDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  return `${String(parts[2]).padStart(2, "0")}/${String(parts[1]).padStart(2, "0")}`;
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function LineChart({
  points,
  formatY,
  formatYAxis,
  yUnit,
  invertY = false,
  height = 220,
}: {
  points: LineChartPoint[];
  formatY: (v: number) => string;
  formatYAxis?: (v: number) => string;
  yUnit?: string;
  invertY?: boolean;
  height?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data</p>;
  }

  const VH = height;
  const IH = VH - PAD.top - PAD.bottom;

  const vals = points.map((p) => p.value);
  const timestamps = points.map((p) => {
    const parts = p.date.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  });

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);

  const ticks = niceTicks(minV, maxV, 5);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yRange = yMax - yMin;

  const yOf = (v: number) => {
    if (yRange === 0) return IH / 2;
    const pct = (v - yMin) / yRange;
    return invertY ? IH * pct : IH * (1 - pct);
  };

  const fmtTick = (v: number): string => {
    if (formatYAxis) return formatYAxis(v);
    if (yUnit) return `${v}`;
    return formatY(v);
  };

  const maxLabelChars = ticks.reduce((max, t) => Math.max(max, fmtTick(t).length), 0);
  const padLeft = Math.ceil(maxLabelChars * CHAR_WIDTH + Y_LABEL_GAP + 8);
  const IW = VW - padLeft - PAD.right;

  const xOf = (ts: number) =>
    minTs === maxTs ? IW / 2 : (IW * (ts - minTs)) / (maxTs - minTs);

  const lineD = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xOf(timestamps[i]).toFixed(1)},${yOf(p.value).toFixed(1)}`
    )
    .join(" ");

  const xTickTs =
    minTs === maxTs
      ? [minTs]
      : Array.from({ length: 5 }, (_, k) => minTs + (k * (maxTs - minTs)) / 4);

  const hovPt = hovered !== null ? points[hovered] : null;

  return (
    <div>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full block" aria-label="Progress chart">
        <defs>
          <linearGradient id="pgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.18} />
            <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <g transform={`translate(${padLeft},${PAD.top})`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={0}
                x2={IW}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke={BORDER_COLOR}
                strokeWidth={0.5}
              />
              <text
                x={-30}
                y={yOf(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={22}
                fill={MUTED_COLOR}
              >
                {fmtTick(t)}
              </text>
            </g>
          ))}

          {xTickTs.map((ts, k) => (
            <text
              key={k}
              x={xOf(ts)}
              y={IH + 46}
              textAnchor="middle"
              fontSize={22}
              fill={MUTED_COLOR}
            >
              {fmtTs(ts)}
            </text>
          ))}

          {points.length > 1 && (
            <path
              d={`${lineD} L${xOf(timestamps[timestamps.length - 1]).toFixed(1)},${IH} L${xOf(timestamps[0]).toFixed(1)},${IH} Z`}
              fill="url(#pgFill)"
            />
          )}

          {points.length > 1 && (
            <path
              d={lineD}
              fill="none"
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {points.map((p, i) => (
            <circle
              key={i}
              cx={xOf(timestamps[i])}
              cy={yOf(p.value)}
              r={hovered === i ? 5 : 3.5}
              fill={LINE_COLOR}
              stroke={CARD_COLOR}
              strokeWidth={1.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </g>
      </svg>

      <div className="h-3 text-center text-[11px] text-muted-foreground tabular-nums">
        {hovPt ? `${fmtXDate(hovPt.date)} · ${formatY(hovPt.value)}` : " "}
      </div>
    </div>
  );
}

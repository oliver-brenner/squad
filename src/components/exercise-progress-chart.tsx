import { useState, useMemo } from "react";
import type { Exercise, ExerciseHistoryEntry } from "@/lib/db/types";
import { Card } from "@/components/ui/card";

type DataPoint = { date: string; value: number };

type Series = {
  key: string;
  label: string;
  points: DataPoint[];
  formatY: (v: number) => string;
  formatYAxis?: (v: number) => string;
  yUnit?: string;
  invertY?: boolean;
};

function strengthSeries(exercise: Exercise, history: ExerciseHistoryEntry[]): Series[] {
  const ormPts: DataPoint[] = [];
  const volPts: DataPoint[] = [];

  for (const entry of [...history].reverse()) {
    let bestWeight = 0;
    let totalVol = 0;
    for (const s of entry.sets) {
      const w = (s.weightKg ?? 0) + exercise.defaultWeightKg;
      const r = s.reps;
      if (!w || !r || r < 1) continue;
      const eff = exercise.doubleReps ? r * 2 : r;
      if (w > bestWeight) bestWeight = w;
      totalVol += eff * w;
    }
    if (bestWeight > 0) ormPts.push({ date: entry.performedOn, value: bestWeight });
    if (totalVol > 0) volPts.push({ date: entry.performedOn, value: Math.round(totalVol) });
  }

  return [
    { key: "orm", label: "Obs. 1RM", points: ormPts, formatY: (v) => `${v}kg`, yUnit: "kg" },
    { key: "volume", label: "Volume", points: volPts, formatY: (v) => `${v}kg`, yUnit: "kg" },
  ];
}

function bodyweightSeries(exercise: Exercise, history: ExerciseHistoryEntry[]): Series[] {
  const bestPts: DataPoint[] = [];
  const volPts: DataPoint[] = [];
  for (const entry of [...history].reverse()) {
    let maxReps = 0;
    let totalReps = 0;
    for (const s of entry.sets) {
      const r = s.reps ?? 0;
      const eff = exercise.doubleReps ? r * 2 : r;
      if (eff > maxReps) maxReps = eff;
      totalReps += eff;
    }
    if (maxReps > 0) bestPts.push({ date: entry.performedOn, value: maxReps });
    if (totalReps > 0) volPts.push({ date: entry.performedOn, value: totalReps });
  }
  return [
    {
      key: "best",
      label: "Best Set",
      points: bestPts,
      formatY: (v) => `${Math.round(v)} reps`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "reps",
    },
    {
      key: "volume",
      label: "Volume",
      points: volPts,
      formatY: (v) => `${Math.round(v)} reps`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "reps",
    },
  ];
}

function cardioSeries(exercise: Exercise, history: ExerciseHistoryEntry[]): Series[] {
  const hasDist = !!exercise.distanceUnit;
  const hasTime = exercise.trackTime;
  const distUnit = (exercise.distanceUnit ?? "km") as "m" | "km" | "yd";
  const result: Series[] = [];

  const toDisplayDist = (km: number): number => {
    if (distUnit === "m") return Math.round(km * 1000);
    if (distUnit === "yd") return Math.round(km * 1093.61);
    return +km.toFixed(2);
  };

  if (hasDist && hasTime) {
    const pts: DataPoint[] = [];
    for (const entry of [...history].reverse()) {
      let dist = 0;
      let sec = 0;
      for (const s of entry.sets) {
        dist += s.distanceKm ?? 0;
        sec += s.durationSec ?? 0;
      }
      if (dist > 0 && sec > 0) pts.push({ date: entry.performedOn, value: sec / dist });
    }
    if (pts.length > 0) {
      result.push({
        key: "pace",
        label: "Pace",
        points: pts,
        invertY: true,
        yUnit: "min/km",
        formatY: (v) => {
          const min = Math.floor(v / 60);
          const sec = Math.round(v % 60);
          return `${min}:${sec.toString().padStart(2, "0")}/km`;
        },
        formatYAxis: (v) => {
          const min = Math.floor(v / 60);
          const sec = Math.round(v % 60);
          return `${min}:${sec.toString().padStart(2, "0")}`;
        },
      });
    }
  }

  if (hasDist) {
    const pts: DataPoint[] = [];
    for (const entry of [...history].reverse()) {
      let dist = 0;
      for (const s of entry.sets) dist += s.distanceKm ?? 0;
      if (dist > 0) pts.push({ date: entry.performedOn, value: toDisplayDist(dist) });
    }
    if (pts.length > 0) {
      result.push({
        key: "distance",
        label: "Distance",
        points: pts,
        yUnit: distUnit,
        formatY: (v) => `${v}${distUnit}`,
      });
    }
  }

  if (hasTime) {
    const pts: DataPoint[] = [];
    for (const entry of [...history].reverse()) {
      let totalSec = 0;
      for (const s of entry.sets) totalSec += s.durationSec ?? 0;
      if (totalSec > 0) pts.push({ date: entry.performedOn, value: totalSec });
    }
    if (pts.length > 0) {
      result.push({
        key: "duration",
        label: "Duration",
        points: pts,
        formatY: (v) =>
          v >= 3600
            ? `${Math.floor(v / 3600)}h${Math.round((v % 3600) / 60)}m`
            : `${Math.round(v / 60)}m`,
      });
    }
  }

  return result;
}

function buildSeries(exercise: Exercise, history: ExerciseHistoryEntry[]): Series[] {
  if (exercise.trackReps && !exercise.isBodyweight) return strengthSeries(exercise, history);
  if (exercise.trackReps && exercise.isBodyweight) return bodyweightSeries(exercise, history);
  return cardioSeries(exercise, history);
}

const VW = 480;
const VH = 220;
const PAD = { top: 20, right: 32, bottom: 48 };
const IH = VH - PAD.top - PAD.bottom;

const AXIS_FONT_SIZE = 22;
const Y_LABEL_GAP = 30;
const CHAR_WIDTH = AXIS_FONT_SIZE * 0.62;

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

const BORDER_COLOR = "hsl(var(--border))";
const MUTED_COLOR = "hsl(var(--muted-foreground))";
const CARD_COLOR = "hsl(var(--card))";
const LINE_COLOR = "#3b82f6";

function LineChart({
  points,
  formatY,
  formatYAxis,
  yUnit,
  invertY = false,
}: {
  points: DataPoint[];
  formatY: (v: number) => string;
  formatYAxis?: (v: number) => string;
  yUnit?: string;
  invertY?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data</p>;
  }

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

interface Props {
  exercise: Exercise;
  history: ExerciseHistoryEntry[];
}

export function ExerciseProgressChart({ exercise, history }: Props) {
  const allSeries = useMemo(() => buildSeries(exercise, history), [exercise, history]);
  const [activeKey, setActiveKey] = useState(() => allSeries[0]?.key ?? "");

  const active = allSeries.find((s) => s.key === activeKey) ?? allSeries[0];

  if (!active || !allSeries.some((s) => s.points.length >= 2)) return null;

  return (
    <Card className="pl-2 pr-4 pt-4 pb-2 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        {allSeries.length > 1 ? (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            {allSeries.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveKey(s.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  s.key === activeKey
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}
        {active.yUnit && (
          <span className="text-xs text-muted-foreground">Unit = {active.yUnit}</span>
        )}
      </div>
      <LineChart
        points={active.points}
        formatY={active.formatY}
        formatYAxis={active.formatYAxis}
        yUnit={active.yUnit}
        invertY={active.invertY}
      />
    </Card>
  );
}

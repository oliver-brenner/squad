import { useState, useMemo } from "react";
import type { Exercise, ExerciseHistoryEntry } from "@/lib/db/types";
import { Card } from "@/components/ui/card";
import { LineChart, type LineChartPoint as DataPoint } from "@/components/charts/line-chart";

type Series = {
  key: string;
  label: string;
  points: DataPoint[];
  formatY: (v: number) => string;
  formatYAxis?: (v: number) => string;
  yUnit?: string;
  invertY?: boolean;
};

function setRounds(s: { circuitId: string | null; circuitRounds: number | null }): number {
  // Non-circuit sets count once; circuit sets multiply by their rounds.
  return s.circuitId ? s.circuitRounds ?? 0 : 1;
}

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
      totalVol += eff * w * setRounds(s);
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
      totalReps += eff * setRounds(s);
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
        const mult = setRounds(s);
        dist += (s.distanceKm ?? 0) * mult;
        sec += (s.durationSec ?? 0) * mult;
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
      for (const s of entry.sets) dist += (s.distanceKm ?? 0) * setRounds(s);
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
      for (const s of entry.sets) totalSec += (s.durationSec ?? 0) * setRounds(s);
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

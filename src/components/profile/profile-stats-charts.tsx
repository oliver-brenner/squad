import { useMemo, useState } from "react";
import { startOfWeek, addDays } from "date-fns";
import { Card } from "@/components/ui/card";
import { LineChart, type LineChartPoint } from "@/components/charts/line-chart";
import type { UserSessionAggregate } from "@/lib/db/queries";

type MetricKey = "exercises" | "sets" | "reps" | "volume" | "workouts";

type Metric = {
  key: MetricKey;
  label: string;
  points: LineChartPoint[];
  formatY: (v: number) => string;
  formatYAxis?: (v: number) => string;
  yUnit?: string;
};

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Counts workouts per ISO week (Mon–Sun), with zero-filled gaps so the line
// reflects actual consistency rather than just "weeks I trained."
function bucketWeekly(dates: string[]): LineChartPoint[] {
  if (dates.length === 0) return [];
  const counts = new Map<string, number>();
  for (const iso of dates) {
    const monday = isoFromDate(startOfWeek(parseIso(iso), { weekStartsOn: 1 }));
    counts.set(monday, (counts.get(monday) ?? 0) + 1);
  }
  const firstMonday = startOfWeek(parseIso(dates[0]), { weekStartsOn: 1 });
  const lastMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const points: LineChartPoint[] = [];
  let cursor = firstMonday;
  while (cursor <= lastMonday) {
    const key = isoFromDate(cursor);
    points.push({ date: key, value: counts.get(key) ?? 0 });
    cursor = addDays(cursor, 7);
  }
  return points;
}

function formatCount(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

function buildMetrics(sessions: UserSessionAggregate[], workoutDates: string[]): Metric[] {
  const exercises: LineChartPoint[] = [];
  const sets: LineChartPoint[] = [];
  const reps: LineChartPoint[] = [];
  const volume: LineChartPoint[] = [];

  for (const s of sessions) {
    if (s.totalExercises > 0) exercises.push({ date: s.performedOn, value: s.totalExercises });
    if (s.totalSets > 0) sets.push({ date: s.performedOn, value: s.totalSets });
    if (s.totalReps > 0) reps.push({ date: s.performedOn, value: s.totalReps });
    if (s.totalVolumeKg > 0)
      volume.push({ date: s.performedOn, value: Math.round(s.totalVolumeKg) });
  }

  return [
    {
      key: "exercises",
      label: "Exercises",
      points: exercises,
      formatY: (v) => `${Math.round(v)}`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "per session",
    },
    {
      key: "sets",
      label: "Sets",
      points: sets,
      formatY: (v) => `${Math.round(v)}`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "per session",
    },
    {
      key: "reps",
      label: "Reps",
      points: reps,
      formatY: formatCount,
      formatYAxis: formatCount,
      yUnit: "per session",
    },
    {
      key: "volume",
      label: "Volume",
      points: volume,
      formatY: (v) => `${Math.round(v)}kg`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "kg per session",
    },
    {
      key: "workouts",
      label: "Workouts",
      points: bucketWeekly(workoutDates),
      formatY: (v) => `${Math.round(v)}`,
      formatYAxis: (v) => `${Math.round(v)}`,
      yUnit: "per week",
    },
  ];
}

interface Props {
  sessions: UserSessionAggregate[];
  workoutDates: string[];
}

export function ProfileStatsCharts({ sessions, workoutDates }: Props) {
  const metrics = useMemo(() => buildMetrics(sessions, workoutDates), [sessions, workoutDates]);
  const [activeKey, setActiveKey] = useState<MetricKey>(() => {
    const preferred: MetricKey[] = ["volume", "sets", "reps", "exercises", "workouts"];
    for (const k of preferred) {
      if ((metrics.find((m) => m.key === k)?.points.length ?? 0) >= 2) return k;
    }
    return metrics[0].key;
  });
  const active = metrics.find((m) => m.key === activeKey) ?? metrics[0];

  if (!metrics.some((m) => m.points.length >= 2)) return null;

  return (
    <Card className="pl-2 pr-4 pt-4 pb-2 flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg bg-muted p-1">
        {metrics.map((m) => (
          <button
            key={m.key}
            onClick={() => setActiveKey(m.key)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              m.key === activeKey
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {active.yUnit && (
        <div className="-mb-1 text-right text-[11px] text-muted-foreground">{active.yUnit}</div>
      )}
      <LineChart
        points={active.points}
        formatY={active.formatY}
        formatYAxis={active.formatYAxis}
        yUnit={active.yUnit}
        height={320}
      />
    </Card>
  );
}

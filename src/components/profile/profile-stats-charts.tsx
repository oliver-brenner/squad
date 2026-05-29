import { useMemo, useState } from "react";
import { startOfWeek, addDays } from "date-fns";
import { Card } from "@/components/ui/card";
import { LineChart, type LineChartPoint } from "@/components/charts/line-chart";
import type { UserSessionAggregate } from "@/lib/db/queries";


type MetricKey = "exercises" | "sets" | "reps" | "volume" | "workouts" | "calories";

type WindowKey = "7d" | "30d" | "all";

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string; days: number | null }> = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "all", label: "all", days: null },
];

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

function withCommas(v: number): string {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Compact form for crowded axes (volume). Hover values stay full-precision.
function compactAxis(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return `${Math.round(v)}`;
}

function buildMetrics(
  sessions: UserSessionAggregate[],
  workoutDates: string[],
  calorieTrackingEnabled: boolean
): Metric[] {
  const exercises: LineChartPoint[] = [];
  const sets: LineChartPoint[] = [];
  const reps: LineChartPoint[] = [];
  const volume: LineChartPoint[] = [];
  const calories: LineChartPoint[] = [];

  for (const s of sessions) {
    if (s.totalExercises > 0) exercises.push({ date: s.performedOn, value: s.totalExercises });
    if (s.totalSets > 0) sets.push({ date: s.performedOn, value: s.totalSets });
    if (s.totalReps > 0) reps.push({ date: s.performedOn, value: s.totalReps });
    if (s.totalVolumeKg > 0)
      volume.push({ date: s.performedOn, value: Math.round(s.totalVolumeKg) });
    if (s.calories != null && s.calories > 0)
      calories.push({ date: s.performedOn, value: s.calories });
  }

  return [
    {
      key: "exercises",
      label: "Exercises",
      points: exercises,
      formatY: withCommas,
      formatYAxis: withCommas,
    },
    {
      key: "sets",
      label: "Sets",
      points: sets,
      formatY: withCommas,
      formatYAxis: withCommas,
    },
    {
      key: "reps",
      label: "Reps",
      points: reps,
      formatY: withCommas,
      formatYAxis: withCommas,
    },
    {
      key: "volume",
      label: "Volume",
      points: volume,
      formatY: (v) => `${withCommas(v)}kg`,
      formatYAxis: compactAxis,
      yUnit: "kg",
    },
    {
      key: "workouts",
      label: "Workouts",
      points: bucketWeekly(workoutDates),
      formatY: withCommas,
      formatYAxis: withCommas,
      yUnit: "per week",
    },
    // Only surfaced when the viewed user has calorie tracking on. Omitted
    // entirely otherwise so the header layout is unchanged for everyone else.
    ...(calorieTrackingEnabled
      ? [
          {
            key: "calories" as const,
            label: "Calories",
            points: calories,
            formatY: withCommas,
            formatYAxis: withCommas,
            yUnit: "kcal",
          },
        ]
      : []),
  ];
}

interface Props {
  sessions: UserSessionAggregate[];
  workoutDates: string[];
  calorieTrackingEnabled?: boolean;
}

export function ProfileStatsCharts({ sessions, workoutDates, calorieTrackingEnabled = false }: Props) {
  const metrics = useMemo(
    () => buildMetrics(sessions, workoutDates, calorieTrackingEnabled),
    [sessions, workoutDates, calorieTrackingEnabled]
  );

  const [activeKey, setActiveKey] = useState<MetricKey>(() => {
    const preferred: MetricKey[] = ["exercises", "sets", "reps", "volume", "workouts"];
    for (const k of preferred) {
      if ((metrics.find((m) => m.key === k)?.points.length ?? 0) >= 2) return k;
    }
    return metrics[0].key;
  });
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const active = metrics.find((m) => m.key === activeKey) ?? metrics[0];

  const showWindowToggle = active.key !== "workouts";

  const visiblePoints = useMemo(() => {
    if (!showWindowToggle) return active.points;
    const days = WINDOW_OPTIONS.find((w) => w.key === windowKey)?.days ?? null;
    if (days === null) return active.points;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
    const cutoffIso = isoFromDate(cutoff);
    return active.points.filter((p) => p.date >= cutoffIso);
  }, [active, showWindowToggle, windowKey]);

  if (!metrics.some((m) => m.points.length >= 2)) return null;

  return (
    <Card className="pl-2 pr-4 pt-4 pb-2 flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
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
      <div className="-mb-1 flex items-center justify-between gap-2 pl-2">
        <span className="text-[11px] text-muted-foreground">{active.yUnit ?? ""}</span>
        {showWindowToggle && (
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.key}
                onClick={() => setWindowKey(w.key)}
                className={`rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  w.key === windowKey
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <LineChart
        points={visiblePoints}
        formatY={active.formatY}
        formatYAxis={active.formatYAxis}
        yUnit={active.yUnit}
        height={320}
      />
    </Card>
  );
}

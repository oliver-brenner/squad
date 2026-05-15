import { useEffect, useState } from "react";
import { getExerciseHistory } from "@/lib/db/queries";
import type { Exercise, WorkoutSet, ExerciseHistoryEntry } from "@/lib/db/types";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSet(s: WorkoutSet, ex: Exercise): string {
  const parts: string[] = [];
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";
  if (!ex.isBodyweight && s.weightKg != null) parts.push(`${s.weightKg} kg`);
  if (ex.trackReps && s.reps != null)
    parts.push(`${s.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && s.durationSec != null)
    parts.push(formatDuration(s.durationSec, (ex.timeUnit ?? "min") as "h" | "min" | "sec"));
  if (ex.trackSpeed && s.speedMs != null) {
    const isKmh = (ex.speedUnit ?? "kmh") === "kmh";
    parts.push(isKmh ? `${+(s.speedMs * 3.6).toFixed(1)} km/h` : `${s.speedMs} m/s`);
  }
  if (ex.trackIncline && s.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${s.inclinePct} incline` : `${s.inclinePct}% incline`
    );
  }
  if (ex.trackResistance && s.resistance != null) parts.push(`res ${s.resistance}`);
  if (ex.distanceUnit && s.distanceKm != null) {
    const dist = toDisplayDist(s.distanceKm, distanceUnit);
    parts.push(`${dist} ${distanceUnit}`);
  }
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatDuration(sec: number, unit: "h" | "min" | "sec"): string {
  if (unit === "sec") return `${sec} secs`;
  if (unit === "min") return `${Math.round((sec / 60) * 10) / 10} mins`;
  return `${Math.round((sec / 3600) * 100) / 100} hrs`;
}

function toDisplayDist(km: number, unit: "m" | "km" | "yd"): number {
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}

interface Props {
  exerciseId: string;
  exercise: Exercise;
  excludeWorkoutId?: string;
  initialEntries?: ExerciseHistoryEntry[];
}

export function ExerciseHistoryList({
  exerciseId,
  exercise,
  excludeWorkoutId,
  initialEntries,
}: Props) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[] | null>(initialEntries ?? null);

  useEffect(() => {
    if (initialEntries) return;
    getExerciseHistory(exerciseId, excludeWorkoutId).then(setEntries);
  }, [exerciseId, excludeWorkoutId, initialEntries]);

  return (
    <div className="flex flex-col">
      <div className="overflow-y-auto max-h-72">
        {entries === null ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No history yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {entries.map((entry) => (
              <div key={entry.workoutId} className="px-3 py-2.5 flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {formatDate(entry.performedOn)}
                </span>
                {entry.sets.map((s, i) => (
                  <div key={s.id} className="flex items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground w-5 shrink-0 text-center text-xs">
                      {i + 1}
                    </span>
                    <span>{formatSet(s, exercise)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

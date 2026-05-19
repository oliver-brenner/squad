import { useEffect, useMemo, useState } from "react";
import { getExerciseHistory } from "@/lib/db/queries";
import type { Exercise, WorkoutSet, ExerciseHistoryEntry } from "@/lib/db/types";
import { computePBsInOrder, type PBType } from "@/lib/stats/set-pbs";
import { PBBadges } from "@/components/pb-badge";

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

// `futureSets` represents sets that are chronologically newer than the rows
// rendered here (e.g. sets in the active workout, when this list is shown via
// `excludeWorkoutId`). They aren't displayed, but they ARE folded into PB
// computation so the badge always lands on the current PB-holder rather than
// staying stuck on a historical set whose record has since been beaten.
type FutureSet = {
  reps: number | null;
  weightKg: number | null;
  distanceKm: number | null;
  durationSec: number | null;
};

interface Props {
  exerciseId: string;
  exercise: Exercise;
  excludeWorkoutId?: string;
  initialEntries?: ExerciseHistoryEntry[];
  futureSets?: FutureSet[];
}

export function ExerciseHistoryList({
  exerciseId,
  exercise,
  excludeWorkoutId,
  initialEntries,
  futureSets,
}: Props) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[] | null>(initialEntries ?? null);

  useEffect(() => {
    if (initialEntries) return;
    getExerciseHistory(exerciseId, excludeWorkoutId).then(setEntries);
  }, [exerciseId, excludeWorkoutId, initialEntries]);

  const pbsBySetId = useMemo(() => {
    const map = new Map<string, PBType[]>();
    if (!entries || entries.length === 0) return map;
    // entries are newest-first; flatten in chronological order (oldest → newest)
    // so the running-max logic in computePBsInOrder marks the right sets.
    const flat: WorkoutSet[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      for (const s of entries[i].sets) flat.push(s);
    }
    // Append future (e.g. active-session) sets so they can claim the latest PB
    // and supersede earlier historical holders. They don't get rendered here.
    const combined = futureSets && futureSets.length > 0 ? [...flat, ...futureSets] : flat;
    const pbs = computePBsInOrder(combined, exercise);
    flat.forEach((s, i) => {
      if (pbs[i].length > 0) map.set(s.id, pbs[i]);
    });
    return map;
  }, [entries, exercise, futureSets]);

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
                {entry.sets.map((s, i) => {
                  const pbs = pbsBySetId.get(s.id);
                  return (
                    <div key={s.id} className="flex items-baseline gap-2 text-sm">
                      <span className="text-muted-foreground w-5 shrink-0 text-center text-xs">
                        {i + 1}
                      </span>
                      <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span>
                          {formatSet(s, exercise)}
                          {s.circuitId && (
                            <span className="text-muted-foreground">
                              {" · "}
                              Circuit x{s.circuitRounds ?? 0}
                            </span>
                          )}
                        </span>
                        {pbs && <PBBadges types={pbs} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useParams, useSearchParams, Navigate } from "react-router-dom";
import { PageHeader } from "@/components/nav/page-header";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { ExerciseProgressChart } from "@/components/exercise-progress-chart";
import { Card } from "@/components/ui/card";
import { recordLoadKg } from "@/lib/set-format";
import { estimateOneRepMax } from "@/lib/stats/one-rep-max";
import { getExerciseById, getExerciseHistory } from "@/lib/db/queries";
import type { Exercise, ExerciseHistoryEntry } from "@/lib/db/types";

type WeightStats = {
  bestSetRawReps: number;
  bestSetWeightKg: number;
  bestOneRepMaxKg: number;
  observedOneRepMaxKg: number;
};

function computeWeightStats(
  exercise: Exercise,
  history: ExerciseHistoryEntry[]
): WeightStats | null {
  if (exercise.isBodyweight || !exercise.trackReps) return null;

  let bestVolume = -Infinity;
  let bestSetRawReps = 0;
  let bestSetWeightKg = 0;
  let bestOneRepMaxKg = 0;
  let observedOneRepMaxKg = 0;

  for (const entry of history) {
    for (const set of entry.sets) {
      // These are all records, so they use the bodyweight-free added-weight
      // scale (see recordLoadKg) — the same one the PB badges use, so the two
      // can't disagree on the same screen. A 1RM estimate needs real weight on
      // the bar, so net-assisted sets are skipped.
      const weight = recordLoadKg(set, exercise) ?? 0;
      const rawReps = set.reps;
      if (weight <= 0 || rawReps == null || rawReps < 1) continue;

      const effectiveReps = exercise.doubleReps ? rawReps * 2 : rawReps;
      const volume = effectiveReps * weight;
      if (volume > bestVolume) {
        bestVolume = volume;
        bestSetRawReps = rawReps;
        bestSetWeightKg = weight;
      }

      const orm = estimateOneRepMax(weight, effectiveReps) ?? 0;
      if (orm > bestOneRepMaxKg) bestOneRepMaxKg = orm;

      if (weight > observedOneRepMaxKg) observedOneRepMaxKg = weight;
    }
  }

  if (bestVolume === -Infinity) return null;
  return { bestSetRawReps, bestSetWeightKg, bestOneRepMaxKg, observedOneRepMaxKg };
}

function formatBestSet(rawReps: number, weightKg: number, doubleReps: boolean): string {
  return `${weightKg} kg · ${rawReps} reps${doubleReps ? " x2" : ""}`;
}

export function ExerciseDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? undefined;

  const [exercise, setExercise] = useState<Exercise | null | undefined>(undefined);
  const [history, setHistory] = useState<ExerciseHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getExerciseById(id), getExerciseHistory(id)])
      .then(([ex, hist]) => {
        if (cancelled) return;
        setExercise(ex);
        setHistory(hist);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[exercise-detail] failed to load:", err);
        // Treat as not-found so we navigate away instead of spinning forever.
        setExercise(null);
        setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (exercise === undefined || history === null) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }
  if (exercise === null) return <Navigate to="/exercises" replace />;

  const weightStats = computeWeightStats(exercise, history);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageHeader
          title={exercise.name}
          backHref={from ?? "/exercises"}
          className="pb-0"
        />
        <div className="flex flex-wrap items-center gap-1 pl-10 -mt-1 text-xs text-muted-foreground">
          <ExerciseMetaTags e={exercise} />
        </div>
      </div>

      {weightStats && (
        <div className="flex flex-col gap-3">
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">Best set</span>
            <span className="text-base font-semibold">
              {formatBestSet(
                weightStats.bestSetRawReps,
                weightStats.bestSetWeightKg,
                exercise.doubleReps
              )}
            </span>
          </Card>
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">Obs. 1RM</span>
            <span className="text-base font-semibold">{weightStats.observedOneRepMaxKg} kg</span>
          </Card>
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">Est. 1RM</span>
            <span className="text-base font-semibold">
              {Math.round(weightStats.bestOneRepMaxKg)} kg
            </span>
          </Card>
        </div>
      )}

      <ExerciseProgressChart exercise={exercise} history={history} />

      <Card className="overflow-hidden p-0">
        <ExerciseHistoryList
          exerciseId={exercise.id}
          exercise={exercise}
          initialEntries={history}
        />
      </Card>
    </div>
  );
}

import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { recordLoadKg } from "@/lib/set-format";
import { estimateOneRepMax } from "./one-rep-max";
import { averagePaceSecPerKm } from "./pace";

export type StrengthPB = {
  exerciseId: string;
  exerciseName: string;
  estimatedOneRepMaxKg: number;
  heaviestWeightKg: number;
  heaviestWeightReps: number;
  onDate: string;
};

export type CardioPB = {
  exerciseId: string;
  exerciseName: string;
  bestAvgPaceSecPerKm: number;
  distanceKm: number;
  durationSec: number;
  onDate: string;
};

type SetWithContext = WorkoutSet & {
  exercise: Exercise;
  performedOn: string;
};

function effectiveReps(set: SetWithContext): number | null {
  if (set.reps == null) return null;
  return set.exercise.doubleReps ? set.reps * 2 : set.reps;
}

// Total load, assistance and bodyweight included — but only for exercises that
// track weight (see recordLoadKg). Sets whose net load isn't positive can't set
// a strength record: an over-assisted set moved nothing.
function effectiveWeight(set: SetWithContext): number | null {
  const load = recordLoadKg(set, set.exercise);
  return load != null && load > 0 ? load : null;
}

export function computeStrengthPBs(sets: SetWithContext[]): Map<string, StrengthPB> {
  const out = new Map<string, StrengthPB>();
  for (const s of sets) {
    if (!s.exercise.categories?.includes("resistance")) continue;
    const w = effectiveWeight(s);
    const r = effectiveReps(s);
    if (w == null || r == null || r < 1) continue;

    const oneRm = estimateOneRepMax(w, r)!;
    const existing = out.get(s.exerciseId);

    if (!existing) {
      out.set(s.exerciseId, {
        exerciseId: s.exerciseId,
        exerciseName: s.exercise.name,
        estimatedOneRepMaxKg: oneRm,
        heaviestWeightKg: w,
        heaviestWeightReps: r,
        onDate: s.performedOn,
      });
      continue;
    }
    if (oneRm > existing.estimatedOneRepMaxKg) {
      existing.estimatedOneRepMaxKg = oneRm;
      existing.onDate = s.performedOn;
    }
    if (
      w > existing.heaviestWeightKg ||
      (w === existing.heaviestWeightKg && r > existing.heaviestWeightReps)
    ) {
      existing.heaviestWeightKg = w;
      existing.heaviestWeightReps = r;
    }
  }
  return out;
}

export function computeCardioPBs(sets: SetWithContext[]): Map<string, CardioPB> {
  const out = new Map<string, CardioPB>();
  for (const s of sets) {
    if (!s.exercise.categories?.includes("cardio")) continue;
    const pace = averagePaceSecPerKm(s.distanceKm, s.durationSec);
    if (pace == null || s.distanceKm == null || s.durationSec == null) continue;
    if (s.distanceKm < 1) continue;

    const existing = out.get(s.exerciseId);
    if (!existing || pace < existing.bestAvgPaceSecPerKm) {
      out.set(s.exerciseId, {
        exerciseId: s.exerciseId,
        exerciseName: s.exercise.name,
        bestAvgPaceSecPerKm: pace,
        distanceKm: s.distanceKm,
        durationSec: s.durationSec,
        onDate: s.performedOn,
      });
    }
  }
  return out;
}

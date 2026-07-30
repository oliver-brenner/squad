import type { Exercise } from "@/lib/db/types";

export type DraftSet = {
  id?: string;
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
  // Bodyweight captured against this set. Only edited for exercises with
  // `includeBodyweight`; ignored by templates (a skeleton has no weigh-in).
  bodyweightKg: number | null;
  distanceKm: number | null;
  durationSec: number | null;
  resistance: number | null;
  speedMs: number | null;
  inclinePct: number | null;
  restSec: number | null;
  calories: number | null;
  rpe: number | null;
  steps: number | null;
  heightM: number | null;
};

// A set with no logged metric of any kind. Newly-added exercises carry one
// such "anchor" set so the exercise persists before anything is logged; the
// editor hides it and shows a greyed "ghost" suggestion in its place instead.
//
// `bodyweightKg` is intentionally not a metric here: it's context carried onto
// the set (pre-filled from the last value), not something the user logged, so a
// set holding only a bodyweight is still blank.
export function isBlankSet(s: DraftSet): boolean {
  return (
    s.reps == null &&
    s.weightKg == null &&
    s.distanceKm == null &&
    s.durationSec == null &&
    s.resistance == null &&
    s.speedMs == null &&
    s.inclinePct == null &&
    s.restSec == null &&
    s.calories == null &&
    s.rpe == null &&
    s.steps == null &&
    s.heightM == null
  );
}

export type ExerciseGroup = {
  groupKey: string;
  exerciseId: string;
  exercise: Exercise;
  sets: DraftSet[];
  // Variation key chosen for this exercise within the session (null = none).
  // Group-level rather than per-set; flattened onto every set on save.
  variation: string | null;
};

export type CircuitGroup = {
  groupKey: string;
  name: string;
  rounds: number;
  exercises: ExerciseGroup[];
};

export type WorkoutItem = ExerciseGroup | CircuitGroup;

export function isCircuitGroup(item: WorkoutItem): item is CircuitGroup {
  return "exercises" in item && !("exerciseId" in item);
}

// Whether any set logged against this item (or, for a circuit, any of its
// exercises) has real data — as opposed to still sitting on its blank anchor
// set. Drives where the live-logging "ghost" boundary sits.
export function groupHasLoggedSet(item: WorkoutItem): boolean {
  if (isCircuitGroup(item)) {
    return item.exercises.some((eg) => eg.sets.some((s) => !isBlankSet(s)));
  }
  return item.sets.some((s) => !isBlankSet(s));
}

export const CIRCUIT_BODY_PREFIX = "circuit-body-";

export function circuitBodyId(circuitKey: string): string {
  return `${CIRCUIT_BODY_PREFIX}${circuitKey}`;
}

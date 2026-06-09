import type { Exercise } from "@/lib/db/types";

export type DraftSet = {
  id?: string;
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
  distanceKm: number | null;
  durationSec: number | null;
  resistance: number | null;
  speedMs: number | null;
  inclinePct: number | null;
  restSec: number | null;
  calories: number | null;
  rpe: number | null;
};

export type ExerciseGroup = {
  groupKey: string;
  exerciseId: string;
  exercise: Exercise;
  sets: DraftSet[];
  // Variation key chosen for this exercise within the session (null = none).
  // Group-level rather than per-set; flattened onto every set on save.
  variation: string | null;
  // Free-text note for this exercise within the session (null/empty = none).
  // Group-level like `variation`; flattened onto every set on save.
  notes: string | null;
  // Whether the exercise note is visible to followers. Public by default.
  notesPublic: boolean;
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

export const CIRCUIT_BODY_PREFIX = "circuit-body-";

export function circuitBodyId(circuitKey: string): string {
  return `${CIRCUIT_BODY_PREFIX}${circuitKey}`;
}

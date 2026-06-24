// Shared, presentation-agnostic logic for the exercise/set/circuit editor used
// by both the workout editor (real sessions) and the template editor
// (skeletons). Keeps the drag-and-drop container math, the sets→items
// reconstruction, and the items→flat-sets flattening in one place so the two
// editors can't drift apart.

import type { Exercise } from "@/lib/db/types";
import {
  CIRCUIT_BODY_PREFIX,
  isCircuitGroup,
  type CircuitGroup,
  type DraftSet,
  type ExerciseGroup,
  type WorkoutItem,
} from "./workout-editor-types";

export const ROOT = "ROOT";

export function findContainer(id: string, items: WorkoutItem[]): string | null {
  if (id.startsWith(CIRCUIT_BODY_PREFIX)) return id.slice(CIRCUIT_BODY_PREFIX.length);
  for (const item of items) {
    if (item.groupKey === id) return ROOT;
    if (isCircuitGroup(item) && item.exercises.some((eg) => eg.groupKey === id)) {
      return item.groupKey;
    }
  }
  return null;
}

export function findExerciseGroupAnywhere(id: string, items: WorkoutItem[]): ExerciseGroup | null {
  for (const item of items) {
    if (isCircuitGroup(item)) {
      const eg = item.exercises.find((e) => e.groupKey === id);
      if (eg) return eg;
    } else if (item.groupKey === id) {
      return item;
    }
  }
  return null;
}

export function removeExerciseFromContainer(items: WorkoutItem[], id: string): WorkoutItem[] {
  return items
    .map((item) => {
      if (isCircuitGroup(item)) {
        const filtered = item.exercises.filter((eg) => eg.groupKey !== id);
        if (filtered.length === item.exercises.length) return item;
        return { ...item, exercises: filtered };
      }
      return item;
    })
    .filter((item) => isCircuitGroup(item) || item.groupKey !== id);
}

export function insertExerciseIntoContainer(
  items: WorkoutItem[],
  exercise: ExerciseGroup,
  container: string,
  overId: string
): WorkoutItem[] {
  if (container === ROOT) {
    const overIndex = items.findIndex((i) => i.groupKey === overId);
    const insertAt = overIndex === -1 ? items.length : overIndex;
    return [...items.slice(0, insertAt), exercise, ...items.slice(insertAt)];
  }
  return items.map((item) => {
    if (!isCircuitGroup(item) || item.groupKey !== container) return item;
    const overIndex = item.exercises.findIndex((eg) => eg.groupKey === overId);
    const insertAt = overIndex === -1 ? item.exercises.length : overIndex;
    return {
      ...item,
      exercises: [
        ...item.exercises.slice(0, insertAt),
        exercise,
        ...item.exercises.slice(insertAt),
      ],
    };
  });
}

export function emptySet(ex: Exercise): DraftSet {
  return {
    exerciseId: ex.id,
    reps: null,
    weightKg: null,
    distanceKm: null,
    durationSec: null,
    resistance: null,
    speedMs: null,
    inclinePct: null,
    restSec: null,
    calories: null,
    rpe: null,
    steps: null,
    heightM: null,
  };
}

// The subset of fields buildItemsFromSets reads — satisfied by both WorkoutSet
// and TemplateSet, so the same reconstruction serves both editors.
export type SkeletonSet = {
  id: string;
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
  steps: number | null;
  heightM: number | null;
  circuitId: string | null;
  circuitRounds: number | null;
  circuitName: string | null;
  variation: string | null;
};

// A flattened set ready to persist (workout or template). Position encodes the
// item/exercise/set ordering; circuit fields are populated only for sets inside
// a circuit.
export type FlatSet = {
  id?: string;
  exerciseId: string;
  position: number;
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
  steps: number | null;
  heightM: number | null;
  circuitId: string | null;
  circuitRounds: number | null;
  circuitName: string | null;
  variation: string | null;
};

// Reconstruct the editor's grouped item model from a flat, position-ordered set
// list. Circuit sets (circuitId set) collapse into a CircuitGroup; everything
// else groups by exercise. Sets whose exercise isn't in `exercises` are skipped.
export function buildItemsFromSets(sets: SkeletonSet[], exercises: Exercise[]): WorkoutItem[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const result: WorkoutItem[] = [];
  const exerciseIndexes = new Map<string, number>();
  const circuitIndexes = new Map<string, number>();

  for (const s of sets) {
    const ex = byId.get(s.exerciseId);
    if (!ex) continue;

    const draft: DraftSet = {
      id: s.id,
      exerciseId: s.exerciseId,
      reps: s.reps,
      weightKg: s.weightKg,
      distanceKm: s.distanceKm,
      durationSec: s.durationSec,
      resistance: s.resistance,
      speedMs: s.speedMs,
      inclinePct: s.inclinePct,
      restSec: s.restSec,
      calories: s.calories,
      rpe: s.rpe,
      steps: s.steps,
      heightM: s.heightM,
    };

    if (s.circuitId) {
      if (!circuitIndexes.has(s.circuitId)) {
        circuitIndexes.set(s.circuitId, result.length);
        result.push({
          groupKey: s.circuitId,
          name: s.circuitName ?? "Circuit",
          rounds: s.circuitRounds ?? 0,
          exercises: [],
        });
      }
      const circuit = result[circuitIndexes.get(s.circuitId)!] as CircuitGroup;
      let eg = circuit.exercises.find((e) => e.exerciseId === ex.id);
      if (!eg) {
        eg = {
          groupKey: crypto.randomUUID(),
          exerciseId: ex.id,
          exercise: ex,
          sets: [],
          variation: s.variation,
        };
        circuit.exercises.push(eg);
      }
      eg.sets.push(draft);
    } else {
      if (!exerciseIndexes.has(ex.id)) {
        exerciseIndexes.set(ex.id, result.length);
        result.push({
          groupKey: ex.id,
          exerciseId: ex.id,
          exercise: ex,
          sets: [],
          variation: s.variation,
        });
      }
      (result[exerciseIndexes.get(ex.id)!] as ExerciseGroup).sets.push(draft);
    }
  }

  return result;
}

// Flatten the grouped item model back to a position-ordered set list. Position
// is a sortable composite of item / exercise-within-circuit / set indexes.
export function flattenItems(items: WorkoutItem[]): FlatSet[] {
  return items.flatMap((item, itemIndex) => {
    if (isCircuitGroup(item)) {
      return item.exercises.flatMap((eg, exIdx) =>
        eg.sets.map((s, si) => ({
          id: s.id,
          exerciseId: eg.exerciseId,
          position: itemIndex * 1000 + exIdx * 10 + si,
          reps: s.reps,
          weightKg: s.weightKg,
          distanceKm: s.distanceKm,
          durationSec: s.durationSec,
          resistance: s.resistance,
          speedMs: s.speedMs,
          inclinePct: s.inclinePct,
          restSec: s.restSec,
          calories: s.calories ?? null,
          rpe: s.rpe ?? null,
          steps: s.steps ?? null,
          heightM: s.heightM ?? null,
          circuitId: item.groupKey,
          circuitRounds: item.rounds,
          circuitName: item.name,
          variation: eg.variation,
        }))
      );
    }
    return item.sets.map((s, si) => ({
      id: s.id,
      exerciseId: item.exerciseId,
      position: itemIndex * 1000 + si,
      reps: s.reps,
      weightKg: s.weightKg,
      distanceKm: s.distanceKm,
      durationSec: s.durationSec,
      resistance: s.resistance,
      speedMs: s.speedMs,
      inclinePct: s.inclinePct,
      restSec: s.restSec,
      calories: s.calories ?? null,
      rpe: s.rpe ?? null,
      steps: s.steps ?? null,
      heightM: s.heightM ?? null,
      circuitId: null as string | null,
      circuitRounds: null as number | null,
      circuitName: null as string | null,
      variation: item.variation,
    }));
  });
}

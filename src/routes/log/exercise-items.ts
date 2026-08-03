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
import { normalizeSegments, totalSegmentRounds } from "./circuit-segments";

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
    // Outside a circuit each set is its own set again — drop the round spans
    // so they don't linger and get re-applied if it's dragged back in.
    const plain: ExerciseGroup = {
      ...exercise,
      sets: exercise.sets.map(({ rounds: _rounds, ...s }) => s),
    };
    return [...items.slice(0, insertAt), plain, ...items.slice(insertAt)];
  }
  return items.map((item) => {
    if (!isCircuitGroup(item) || item.groupKey !== container) return item;
    const overIndex = item.exercises.findIndex((eg) => eg.groupKey === overId);
    const insertAt = overIndex === -1 ? item.exercises.length : overIndex;
    return {
      ...item,
      exercises: [
        ...item.exercises.slice(0, insertAt),
        // An exercise dragged in from outside brings a plain set list; fit it
        // to the circuit's rounds so the round segments stay consistent.
        { ...exercise, sets: normalizeSegments(exercise.sets, item.rounds) },
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
    bodyweightKg: null,
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
  // Optional: WorkoutSet carries it, TemplateSet has no such column.
  bodyweightKg?: number | null;
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
  // Dropped by the template writer's schema — templates have no bodyweight.
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
      bodyweightKg: s.bodyweightKg ?? null,
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
          // Filled in below, once every set of the circuit has been seen.
          rounds: 0,
          exercises: [],
        });
      }
      const circuit = result[circuitIndexes.get(s.circuitId)!] as CircuitGroup;
      // Consecutive sets of the same exercise are that exercise's round
      // segments; a later, non-adjacent run of the same exercise is a separate
      // entry in the circuit (an exercise the user duplicated) and must not be
      // folded back into the first — that would double its round count.
      const last = circuit.exercises[circuit.exercises.length - 1];
      let eg = last?.exerciseId === ex.id ? last : undefined;
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
      draft.rounds = s.circuitRounds ?? 0;
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

  // A circuit's round count is what its exercises' segments add up to (they all
  // describe the same rounds, so the longest one wins if data ever disagrees).
  // For a session logged before per-round values, each exercise has a single
  // set carrying the whole count, so this is exactly the old `circuit_rounds`.
  for (const item of result) {
    if (!isCircuitGroup(item)) continue;
    item.rounds = item.exercises.reduce(
      (max, eg) => Math.max(max, totalSegmentRounds(eg.sets)),
      0
    );
    for (const eg of item.exercises) {
      eg.sets = normalizeSegments(eg.sets, item.rounds);
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
          bodyweightKg: s.bodyweightKg ?? null,
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
          // Per-set: the rounds THIS set was performed for. Equal to the
          // circuit's total unless the user split the rounds up.
          circuitRounds: s.rounds ?? item.rounds,
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
      bodyweightKg: s.bodyweightKg ?? null,
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

// Exports a workout into a render-ready shape for the receipt sheet.
// Joins workouts → sets → exercises → user_field_options to resolve every
// category/equipment/muscle key into its display label.

import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { decodeExercise, decodeWorkout } from "@/lib/db/decoders";
import { getProfileBodyweightKg } from "@/lib/db/queries";
import type {
  ExerciseRow,
  WorkoutRow,
  WorkoutSetRow,
  UserFieldOptionRow,
} from "@/lib/db/schema";
import { MUSCLE_LABELS } from "@/lib/exercise-options";

export type SessionExportSet = {
  reps: number | null;
  weightKg: number | null;
  // Only populated when the exercise includes bodyweight; the receipt folds it
  // into the printed weight so the totals match the app.
  bodyweightKg: number | null;
  distanceKm: number | null;
  durationSec: number | null;
  resistance: number | null;
  speedMs: number | null;
  inclinePct: number | null;
  restSec: number | null;
  rpe: number | null;
  // Circuit sets only: how many rounds were performed with these values. Null
  // outside a circuit.
  rounds?: number | null;
};

export type SessionExportExercise = {
  name: string;
  categories: string[] | null;
  equipment: string | null;
  muscles: string[] | null;
  secondaryMuscles: string[] | null;
  defaultWeightKg: number;
  doubleReps: boolean;
  sets: SessionExportSet[];
};

export type SessionExportItem =
  | { type: "exercise"; data: SessionExportExercise }
  | { type: "circuit"; name: string; rounds: number; exercises: SessionExportExercise[] };

export type SessionExportData = {
  name: string;
  performedOn: string;
  sessionType: string;
  notes: string | null;
  items: SessionExportItem[];
};

export async function getSessionExportData(workoutId: string): Promise<SessionExportData | null> {
  const workoutRow = await powersync.getOptional<WorkoutRow>(
    `SELECT * FROM workouts WHERE id = ?`,
    [workoutId]
  );
  if (!workoutRow) return null;
  const workout = decodeWorkout(workoutRow);

  const setRows = await powersync.getAll<WorkoutSetRow>(
    `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
    [workoutId]
  );

  if (setRows.length === 0) {
    return {
      name: workout.name,
      performedOn: workout.performedOn,
      sessionType: workout.sessionType,
      notes: workout.notes,
      items: [],
    };
  }

  const exerciseIds = [...new Set(setRows.map((s) => s.exercise_id).filter((v): v is string => !!v))];
  const placeholders = exerciseIds.map(() => "?").join(",");

  const userId = await getCurrentUserId();
  // Fallback bodyweight for sets logged before per-set bodyweight existed —
  // same rule the volume aggregates use.
  const profileBodyweightKg = await getProfileBodyweightKg(userId);
  const [exerciseRows, optionRows] = await Promise.all([
    powersync.getAll<ExerciseRow>(
      `SELECT * FROM exercises WHERE id IN (${placeholders})`,
      exerciseIds
    ),
    powersync.getAll<UserFieldOptionRow>(
      `SELECT * FROM user_field_options WHERE user_id = ?`,
      [userId]
    ),
  ]);

  const exerciseById = new Map(exerciseRows.map((e) => [e.id, decodeExercise(e)]));

  const keyToLabel = new Map<string, string>(
    optionRows.map((o) => [o.key ?? "", o.label ?? ""])
  );
  const keyToPosition = new Map<string, number>(
    optionRows.map((o) => [o.key ?? "", o.position ?? 0])
  );
  const keyToParentId = new Map<string, string | null>(
    optionRows.map((o) => [o.key ?? "", o.parent_id ?? null])
  );
  const idToKey = new Map<string, string>(
    optionRows.map((o) => [o.id, o.key ?? ""])
  );

  function resolveLabel(key: string): string {
    return keyToLabel.get(key) ?? MUSCLE_LABELS[key as keyof typeof MUSCLE_LABELS] ?? key;
  }
  function resolveLabels(keys: string[] | null): string[] | null {
    if (!keys) return null;
    return keys.map(resolveLabel);
  }
  function sortFilterMuscles(muscleKeys: string[]): string[] {
    const muscleSet = new Set(muscleKeys);
    const parentsWithChildSelected = new Set<string>();
    for (const key of muscleKeys) {
      const parentId = keyToParentId.get(key);
      if (parentId) {
        const parentKey = idToKey.get(parentId);
        if (parentKey && muscleSet.has(parentKey)) parentsWithChildSelected.add(parentKey);
      }
    }
    return muscleKeys
      .filter((k) => !parentsWithChildSelected.has(k))
      .sort((a, b) => (keyToPosition.get(a) ?? 9999) - (keyToPosition.get(b) ?? 9999))
      .map(resolveLabel);
  }

  const itemsMap = new Map<string, SessionExportItem>();
  const itemOrder: string[] = [];

  for (const s of setRows) {
    const ex = exerciseById.get(s.exercise_id ?? "");
    if (!ex) continue;

    const setData: SessionExportSet = {
      reps: s.reps,
      weightKg: s.weight_kg,
      bodyweightKg: ex.includeBodyweight ? s.bodyweight_kg ?? profileBodyweightKg : null,
      distanceKm: s.distance_km,
      durationSec: s.duration_sec,
      resistance: s.resistance,
      speedMs: s.speed_ms,
      inclinePct: s.incline_pct,
      restSec: s.rest_sec,
      rpe: s.rpe,
    };

    if (s.circuit_id) {
      const key = `circuit:${s.circuit_id}`;
      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          type: "circuit",
          name: s.circuit_name ?? "Circuit",
          // Summed from the per-set rounds below.
          rounds: 0,
          exercises: [],
        });
        itemOrder.push(key);
      }
      const circuit = itemsMap.get(key) as Extract<SessionExportItem, { type: "circuit" }>;
      setData.rounds = s.circuit_rounds;
      // Consecutive sets of one exercise are its round segments; a later run of
      // the same exercise is a duplicated entry in the circuit.
      const prev = circuit.exercises[circuit.exercises.length - 1];
      let eg = prev?.name === ex.name ? prev : undefined;
      if (!eg) {
        eg = {
          name: ex.name,
          categories: resolveLabels(ex.categories ?? null),
          equipment: ex.equipment ? resolveLabel(ex.equipment) : null,
          muscles: sortFilterMuscles(ex.muscles ?? []),
          secondaryMuscles: sortFilterMuscles(ex.secondaryMuscles ?? []),
          defaultWeightKg: ex.defaultWeightKg,
          doubleReps: ex.doubleReps,
          sets: [],
        };
        circuit.exercises.push(eg);
      }
      eg.sets.push(setData);
    } else {
      const key = `exercise:${ex.id}`;
      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          type: "exercise",
          data: {
            name: ex.name,
            categories: resolveLabels(ex.categories ?? null),
            equipment: ex.equipment ? resolveLabel(ex.equipment) : null,
            muscles: sortFilterMuscles(ex.muscles ?? []),
            secondaryMuscles: sortFilterMuscles(ex.secondaryMuscles ?? []),
            defaultWeightKg: ex.defaultWeightKg,
            doubleReps: ex.doubleReps,
            sets: [],
          },
        });
        itemOrder.push(key);
      }
      const item = itemsMap.get(key) as Extract<SessionExportItem, { type: "exercise" }>;
      item.data.sets.push(setData);
    }
  }

  // A circuit ran for as many rounds as its exercises' per-set rounds add up
  // to — the same for every exercise, and just the one circuit_rounds value
  // when the rounds weren't split into different set values.
  for (const item of itemsMap.values()) {
    if (item.type !== "circuit") continue;
    item.rounds = item.exercises.reduce(
      (max, eg) => Math.max(max, eg.sets.reduce((n, s) => n + (s.rounds ?? 0), 0)),
      0
    );
  }

  return {
    name: workout.name,
    performedOn: workout.performedOn,
    sessionType: workout.sessionType,
    notes: workout.notes,
    items: itemOrder.map((k) => itemsMap.get(k)!),
  };
}

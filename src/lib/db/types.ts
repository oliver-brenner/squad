// Decoded entity types that UI code consumes. Mirrors the field names from
// gymtracker's Drizzle types (camelCase, real booleans, real arrays).
// Decoders that produce these from raw rows live in `./decoders.ts`.

import type { SessionType } from "./schema";

// A variation belongs to a single exercise (not a shared library). `key` is a
// stable identifier carried onto `sets.variation` when chosen in a session, so
// renaming `label` never orphans past sets. Stored as a jsonb array on the
// exercise; array order is the display order.
export type ExerciseVariation = { key: string; label: string };

export type Profile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bodyweightKg: number | null;
  calorieTrackingEnabled: boolean;
  durationTrackingEnabled: boolean;
  sex: "male" | "female";
  createdAt: string;
};

export type Exercise = {
  id: string;
  userId: string;
  name: string;
  categories: string[] | null;
  equipment: string | null;
  isBodyweight: boolean;
  includeBodyweight: boolean;
  trackReps: boolean;
  defaultWeightKg: number;
  doubleReps: boolean;
  distanceUnit: string | null;
  trackTime: boolean;
  timeUnit: string | null;
  trackResistance: boolean;
  trackSpeed: boolean;
  speedUnit: string | null;
  trackIncline: boolean;
  inclineUnit: string | null;
  trackRest: boolean;
  trackCalories: boolean;
  trackRpe: boolean;
  trackSteps: boolean;
  heightUnit: string | null;
  muscles: string[] | null;
  secondaryMuscles: string[] | null;
  variations: ExerciseVariation[] | null;
  notes: string | null;
  createdAt: string;
};

export type Workout = {
  id: string;
  userId: string;
  name: string;
  performedOn: string;
  sessionType: SessionType;
  notes: string | null;
  notesPublic: boolean;
  calories: number | null;
  // Total session time in seconds (hand-entered), independent of set durations.
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutSet = {
  id: string;
  userId: string;
  performedOn: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  reps: number | null;
  // Negative for an assisted exercise — the assistance subtracts from the load.
  weightKg: number | null;
  // Bodyweight snapshot for this set (see schema). Null for sets logged before
  // per-set bodyweight, and for exercises that don't include bodyweight.
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

export type UserFieldOption = {
  id: string;
  userId: string;
  kind: "category" | "equipment" | "muscle_group" | "muscle_child";
  parentId: string | null;
  key: string;
  label: string;
  position: number;
  createdAt: string;
};

export type Follow = {
  id: string;
  followerId: string;
  followeeId: string;
  createdAt: string;
};

export type SessionGuest = {
  id: string;
  userId: string;
  workoutId: string;
  guestProfileId: string | null;
  guestName: string | null;
  position: number;
  createdAt: string;
};

export type Template = {
  id: string;
  userId: string;
  name: string;
  sessionType: SessionType;
  notes: string | null;
  notesPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

// A template's skeleton set. Mirrors WorkoutSet without the workout-bound
// fields (workoutId, performedOn) — templates have no date.
export type TemplateSet = {
  id: string;
  userId: string;
  templateId: string;
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

export type WorkoutWithSets = { workout: Workout; sets: WorkoutSet[] };

export type TemplateWithSets = { template: Template; sets: TemplateSet[] };

export type ExerciseHistoryEntry = {
  workoutId: string;
  workoutName: string;
  performedOn: string;
  sets: WorkoutSet[];
};

export type SetWithExerciseRow = {
  set: WorkoutSet;
  exercise: Exercise;
  performedOn: string;
  workoutId: string;
};

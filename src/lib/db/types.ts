// Decoded entity types that UI code consumes. Mirrors the field names from
// gymtracker's Drizzle types (camelCase, real booleans, real arrays).
// Decoders that produce these from raw rows live in `./decoders.ts`.

import type { SessionType } from "./schema";

export type Profile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type Exercise = {
  id: string;
  userId: string;
  name: string;
  categories: string[] | null;
  equipment: string | null;
  isBodyweight: boolean;
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
  muscles: string[] | null;
  secondaryMuscles: string[] | null;
  archivedAt: string | null;
  createdAt: string;
};

export type Workout = {
  id: string;
  userId: string;
  name: string;
  performedOn: string;
  sessionType: SessionType;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutSet = {
  id: string;
  userId: string;
  workoutId: string;
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
  circuitId: string | null;
  circuitRounds: number | null;
  circuitName: string | null;
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

export type WorkoutWithSets = { workout: Workout; sets: WorkoutSet[] };

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

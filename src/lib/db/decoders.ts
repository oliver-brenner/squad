// Decoders translate raw SQLite rows (snake_case, ints-for-bools, JSON-string
// arrays) into the typed camelCase entities UI code consumes.

import { arr, bool, decodeVariations, unwrapPgArrayLiteral } from "./encoding";
import type {
  ExerciseRow,
  ProfileRow,
  UserFieldOptionRow,
  WorkoutRow,
  WorkoutSetRow,
  FollowRow,
  SessionGuestRow,
  TemplateRow,
  TemplateSetRow,
  SessionType,
} from "./schema";
import type {
  Exercise,
  Profile,
  UserFieldOption,
  Workout,
  WorkoutSet,
  Follow,
  SessionGuest,
  Template,
  TemplateSet,
} from "./types";

export function decodeProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    bodyweightKg: r.bodyweight_kg,
    calorieTrackingEnabled: bool(r.calorie_tracking_enabled),
    durationTrackingEnabled: bool(r.duration_tracking_enabled),
    sex: r.sex === "female" ? "female" : "male",
    createdAt: r.created_at ?? "",
  };
}

export function decodeExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name ?? "",
    categories: arr(r.categories),
    equipment: unwrapPgArrayLiteral(r.equipment),
    isBodyweight: bool(r.is_bodyweight),
    includeBodyweight: bool(r.include_bodyweight),
    trackReps: bool(r.track_reps),
    defaultWeightKg: r.default_weight_kg ?? 0,
    doubleReps: bool(r.double_reps),
    distanceUnit: r.distance_unit,
    trackTime: bool(r.track_time),
    timeUnit: r.time_unit,
    trackResistance: bool(r.track_resistance),
    trackSpeed: bool(r.track_speed),
    speedUnit: r.speed_unit,
    trackIncline: bool(r.track_incline),
    inclineUnit: r.incline_unit,
    trackRest: bool(r.track_rest),
    trackCalories: bool(r.track_calories),
    trackRpe: bool(r.track_rpe),
    trackSteps: bool(r.track_steps),
    heightUnit: r.height_unit,
    muscles: arr(r.muscles),
    secondaryMuscles: arr(r.secondary_muscles),
    variations: decodeVariations(r.variations),
    notes: r.notes ?? null,
    createdAt: r.created_at ?? "",
  };
}

export function decodeWorkout(r: WorkoutRow): Workout {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name ?? "",
    performedOn: r.performed_on ?? "",
    sessionType: (r.session_type ?? "workout") as SessionType,
    notes: r.notes,
    // Public by default: a missing flag (older rows) reads as public.
    notesPublic: r.notes_public == null ? true : bool(r.notes_public),
    calories: r.calories,
    durationSec: r.duration_sec,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

export function decodeSet(r: WorkoutSetRow): WorkoutSet {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    performedOn: r.performed_on ?? "",
    workoutId: r.workout_id ?? "",
    exerciseId: r.exercise_id ?? "",
    position: r.position ?? 0,
    reps: r.reps,
    weightKg: r.weight_kg,
    bodyweightKg: r.bodyweight_kg,
    distanceKm: r.distance_km,
    durationSec: r.duration_sec,
    resistance: r.resistance,
    speedMs: r.speed_ms,
    inclinePct: r.incline_pct,
    restSec: r.rest_sec,
    calories: r.calories,
    rpe: r.rpe,
    steps: r.steps,
    heightM: r.height_m,
    circuitId: r.circuit_id,
    circuitRounds: r.circuit_rounds,
    circuitName: r.circuit_name,
    variation: r.variation,
  };
}

export function decodeUserFieldOption(r: UserFieldOptionRow): UserFieldOption {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    kind: (r.kind ?? "category") as UserFieldOption["kind"],
    parentId: r.parent_id,
    key: r.key ?? "",
    label: r.label ?? "",
    position: r.position ?? 0,
    createdAt: r.created_at ?? "",
  };
}

export function decodeSessionGuest(r: SessionGuestRow): SessionGuest {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    workoutId: r.workout_id ?? "",
    guestProfileId: r.guest_profile_id,
    guestName: r.guest_name,
    position: r.position ?? 0,
    createdAt: r.created_at ?? "",
  };
}

export function decodeTemplate(r: TemplateRow): Template {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    name: r.name ?? "",
    sessionType: (r.session_type ?? "workout") as SessionType,
    notes: r.notes ?? null,
    notesPublic: r.notes_public == null ? true : bool(r.notes_public),
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

export function decodeTemplateSet(r: TemplateSetRow): TemplateSet {
  return {
    id: r.id,
    userId: r.user_id ?? "",
    templateId: r.template_id ?? "",
    exerciseId: r.exercise_id ?? "",
    position: r.position ?? 0,
    reps: r.reps,
    weightKg: r.weight_kg,
    distanceKm: r.distance_km,
    durationSec: r.duration_sec,
    resistance: r.resistance,
    speedMs: r.speed_ms,
    inclinePct: r.incline_pct,
    restSec: r.rest_sec,
    calories: r.calories,
    rpe: r.rpe,
    steps: r.steps,
    heightM: r.height_m,
    circuitId: r.circuit_id,
    circuitRounds: r.circuit_rounds,
    circuitName: r.circuit_name,
    variation: r.variation,
  };
}

export function decodeFollow(r: FollowRow): Follow {
  return {
    id: r.id,
    followerId: r.follower_id ?? "",
    followeeId: r.followee_id ?? "",
    createdAt: r.created_at ?? "",
  };
}

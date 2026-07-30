// Shared dashboard data hook: every set joined with its workout date and
// exercise metadata, all-time. Callers slice by date in memory — the local
// SQLite join is microseconds and one reactive query beats three.

import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeExercise, decodeSet } from "@/lib/db/decoders";
import type { WorkoutSetRow, ExerciseRow } from "@/lib/db/schema";
import type { SetWithExerciseRow } from "@/lib/db/types";

type SetExerciseJoinRow = WorkoutSetRow & {
  performed_on: string;
  workout_id_alias: string;
  ex_id: string;
  ex_user_id: string | null;
  ex_name: string | null;
  ex_categories: string | null;
  ex_equipment: string | null;
  ex_is_bodyweight: number | null;
  ex_include_bodyweight: number | null;
  ex_track_reps: number | null;
  ex_default_weight_kg: number | null;
  ex_double_reps: number | null;
  ex_distance_unit: string | null;
  ex_track_time: number | null;
  ex_time_unit: string | null;
  ex_track_resistance: number | null;
  ex_track_speed: number | null;
  ex_speed_unit: string | null;
  ex_track_incline: number | null;
  ex_incline_unit: string | null;
  ex_track_rest: number | null;
  ex_muscles: string | null;
  ex_secondary_muscles: string | null;
  ex_created_at: string | null;
};

function buildExerciseRow(r: SetExerciseJoinRow): ExerciseRow {
  return {
    id: r.ex_id,
    user_id: r.ex_user_id,
    name: r.ex_name,
    categories: r.ex_categories,
    equipment: r.ex_equipment,
    is_bodyweight: r.ex_is_bodyweight,
    include_bodyweight: r.ex_include_bodyweight,
    track_reps: r.ex_track_reps,
    default_weight_kg: r.ex_default_weight_kg,
    double_reps: r.ex_double_reps,
    distance_unit: r.ex_distance_unit,
    track_time: r.ex_track_time,
    time_unit: r.ex_time_unit,
    track_resistance: r.ex_track_resistance,
    track_speed: r.ex_track_speed,
    speed_unit: r.ex_speed_unit,
    track_incline: r.ex_track_incline,
    incline_unit: r.ex_incline_unit,
    track_rest: r.ex_track_rest,
    track_calories: null,
    track_rpe: null,
    track_steps: null,
    height_unit: null,
    muscles: r.ex_muscles,
    secondary_muscles: r.ex_secondary_muscles,
    variations: null,
    notes: null,
    created_at: r.ex_created_at,
  };
}

export function useSetExerciseRows(): SetWithExerciseRow[] {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { data: rows = [] } = useQuery<SetExerciseJoinRow>(
    `SELECT s.*, w.performed_on AS performed_on, w.id AS workout_id_alias,
            e.id AS ex_id, e.user_id AS ex_user_id, e.name AS ex_name,
            e.categories AS ex_categories, e.equipment AS ex_equipment,
            e.is_bodyweight AS ex_is_bodyweight,
            e.include_bodyweight AS ex_include_bodyweight, e.track_reps AS ex_track_reps,
            e.default_weight_kg AS ex_default_weight_kg, e.double_reps AS ex_double_reps,
            e.distance_unit AS ex_distance_unit, e.track_time AS ex_track_time,
            e.time_unit AS ex_time_unit, e.track_resistance AS ex_track_resistance,
            e.track_speed AS ex_track_speed, e.speed_unit AS ex_speed_unit,
            e.track_incline AS ex_track_incline, e.incline_unit AS ex_incline_unit,
            e.track_rest AS ex_track_rest, e.muscles AS ex_muscles,
            e.secondary_muscles AS ex_secondary_muscles,
            e.created_at AS ex_created_at
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE w.user_id = ?`,
    [userId]
  );

  return useMemo(
    () =>
      rows.map((r) => ({
        set: decodeSet(r),
        exercise: decodeExercise(buildExerciseRow(r)),
        performedOn: r.performed_on,
        workoutId: r.workout_id_alias,
      })),
    [rows]
  );
}

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeExercise, decodeSet } from "@/lib/db/decoders";
import type { WorkoutSetRow, ExerciseRow } from "@/lib/db/schema";
import type { SetWithExerciseRow } from "@/lib/db/types";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import { computeExerciseBreakdown } from "@/lib/stats/exercise-breakdown";
import { TrainingBreakdownPanels } from "@/components/stats/training-breakdown";

type SetExerciseJoinRow = WorkoutSetRow & {
  performed_on: string;
  workout_id_alias: string;
  ex_id: string;
  ex_user_id: string | null;
  ex_name: string | null;
  ex_categories: string | null;
  ex_equipment: string | null;
  ex_is_bodyweight: number | null;
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
  ex_archived_at: string | null;
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
    muscles: r.ex_muscles,
    secondary_muscles: r.ex_secondary_muscles,
    archived_at: r.ex_archived_at,
    created_at: r.ex_created_at,
  };
}

export function ExerciseBreakdown() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [days, setDays] = useState<7 | 30 | "all">(7);
  const { muscleGroups } = useUserFieldOptions();

  const sinceIso =
    days === "all" ? "0001-01-01" : format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  // Single JOIN query — local SQLite handles the join in microseconds.
  const { data: rows = [] } = useQuery<SetExerciseJoinRow>(
    `SELECT s.*, w.performed_on AS performed_on, w.id AS workout_id_alias,
            e.id AS ex_id, e.user_id AS ex_user_id, e.name AS ex_name,
            e.categories AS ex_categories, e.equipment AS ex_equipment,
            e.is_bodyweight AS ex_is_bodyweight, e.track_reps AS ex_track_reps,
            e.default_weight_kg AS ex_default_weight_kg, e.double_reps AS ex_double_reps,
            e.distance_unit AS ex_distance_unit, e.track_time AS ex_track_time,
            e.time_unit AS ex_time_unit, e.track_resistance AS ex_track_resistance,
            e.track_speed AS ex_track_speed, e.speed_unit AS ex_speed_unit,
            e.track_incline AS ex_track_incline, e.incline_unit AS ex_incline_unit,
            e.track_rest AS ex_track_rest, e.muscles AS ex_muscles,
            e.secondary_muscles AS ex_secondary_muscles, e.archived_at AS ex_archived_at,
            e.created_at AS ex_created_at
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE w.user_id = ? AND w.performed_on >= ?`,
    [userId, sinceIso]
  );

  const data = useMemo(() => {
    const setRows: SetWithExerciseRow[] = rows.map((r) => ({
      set: decodeSet(r),
      exercise: decodeExercise(buildExerciseRow(r)),
      performedOn: r.performed_on,
      workoutId: r.workout_id_alias,
    }));
    return computeExerciseBreakdown(setRows, muscleGroups);
  }, [rows, muscleGroups]);

  return (
    <section className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Training Breakdown
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {([7, 30, "all"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md w-8 py-1 text-xs font-medium text-center transition-colors ${
                days === d
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d === "all" ? "all" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      <TrainingBreakdownPanels data={data} />
    </section>
  );
}

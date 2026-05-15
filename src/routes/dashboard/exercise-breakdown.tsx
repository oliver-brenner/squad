import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { useQuery } from "@powersync/react";
import { decodeExercise, decodeSet } from "@/lib/db/decoders";
import type { ExerciseRow, WorkoutSetRow } from "@/lib/db/schema";
import type { SetWithExerciseRow } from "@/lib/db/types";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import {
  computeExerciseBreakdown,
  type MuscleStatRow,
  type StatRow,
} from "@/lib/stats/exercise-breakdown";

const CATEGORY_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  resistance: { bar: "bg-blue-400/55", text: "text-blue-400/75", bg: "bg-blue-400/10" },
  functional: { bar: "bg-emerald-400/55", text: "text-emerald-400/75", bg: "bg-emerald-400/10" },
  conditioning: { bar: "bg-orange-400/55", text: "text-orange-400/75", bg: "bg-orange-400/10" },
  cardio: { bar: "bg-violet-400/55", text: "text-violet-400/75", bg: "bg-violet-400/10" },
  mobility: { bar: "bg-sky-400/55", text: "text-sky-400/75", bg: "bg-sky-400/10" },
};

const FALLBACK_COLOR = {
  bar: "bg-muted-foreground/40",
  text: "text-muted-foreground/60",
  bg: "bg-muted/40",
};

const PRIMARY_MUSCLE_COLOR = {
  bar: "bg-blue-700/60",
  text: "text-blue-500",
  swatch: "bg-blue-700/60",
};
const SECONDARY_MUSCLE_COLOR = {
  bar: "bg-teal-600/60",
  text: "text-teal-500",
  swatch: "bg-teal-600/60",
};

function MuscleBreakdownRow({ row, maxCombined }: { row: MuscleStatRow; maxCombined: number }) {
  const combined = row.primaryPct + row.secondaryPct;
  const barWidth = maxCombined > 0 ? (combined / maxCombined) * 100 : 0;
  const primaryWidth = combined > 0 ? (row.primaryPct / combined) * 100 : 0;
  const secondaryWidth = combined > 0 ? (row.secondaryPct / combined) * 100 : 0;
  return (
    <>
      <span className="text-sm font-medium text-foreground/80 truncate">{row.label}</span>
      <div className="h-1.5 rounded-full bg-muted/40">
        <div
          className="h-full rounded-full overflow-hidden flex"
          style={{ width: `${barWidth}%` }}
        >
          {row.primaryPct > 0 && (
            <div
              className={`h-full ${PRIMARY_MUSCLE_COLOR.bar}`}
              style={{ width: `${primaryWidth}%` }}
            />
          )}
          {row.secondaryPct > 0 && (
            <div
              className={`h-full ${SECONDARY_MUSCLE_COLOR.bar}`}
              style={{ width: `${secondaryWidth}%` }}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs">
        {row.primaryPct > 0 && (
          <span className={`font-semibold tabular-nums ${PRIMARY_MUSCLE_COLOR.text}`}>
            {row.primaryPct}%
          </span>
        )}
        {row.secondaryPct > 0 && (
          <span className={`font-semibold tabular-nums ${SECONDARY_MUSCLE_COLOR.text}`}>
            {row.secondaryPct}%
          </span>
        )}
      </div>
    </>
  );
}

function BreakdownRow({
  row,
  colorMap,
  maxPct,
}: {
  row: StatRow;
  colorMap: Record<string, { bar: string; text: string; bg: string }>;
  maxPct: number;
}) {
  const colors = colorMap[row.id] ?? FALLBACK_COLOR;
  const barWidth = maxPct > 0 ? (row.pct / maxPct) * 100 : 0;
  return (
    <>
      <span className="text-sm font-medium text-foreground/80 truncate">{row.label}</span>
      <div className={`h-1.5 rounded-full ${colors.bg}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${colors.text}`}>{row.pct}%</span>
    </>
  );
}

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
  const [days, setDays] = useState<7 | 30 | "all">(7);
  const { muscleGroups } = useUserFieldOptions();

  const sinceIso =
    days === "all" ? "0001-01-01" : format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  // Single JOIN query — local SQLite handles the join in microseconds.
  const { data: rows = [], isLoading } = useQuery<SetExerciseJoinRow>(
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
     WHERE w.performed_on >= ?`,
    [sinceIso]
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

  const isEmpty = !isLoading && data.totalExercises === 0;

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

      {isEmpty ? (
        <p className="text-xs text-muted-foreground px-1">No exercise data for this period.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Muscle groups
              </span>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-sm ${PRIMARY_MUSCLE_COLOR.swatch}`}
                  />
                  Primary
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-sm ${SECONDARY_MUSCLE_COLOR.swatch}`}
                  />
                  Secondary
                </span>
              </div>
            </div>
            {(() => {
              const maxCombined = Math.max(
                ...data.muscleGroups.map((r) => r.primaryPct + r.secondaryPct),
                1
              );
              return (
                <div
                  className="grid items-center gap-x-2 gap-y-2.5"
                  style={{ gridTemplateColumns: "auto 1fr auto" }}
                >
                  {data.muscleGroups.map((row) => (
                    <MuscleBreakdownRow key={row.id} row={row} maxCombined={maxCombined} />
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Exercise type
            </span>
            {(() => {
              const maxPct = Math.max(...data.categories.map((r) => r.pct), 1);
              return (
                <div
                  className="grid items-center gap-x-2 gap-y-2.5"
                  style={{ gridTemplateColumns: "auto 1fr auto" }}
                >
                  {data.categories.map((row) => (
                    <BreakdownRow
                      key={row.id}
                      row={row}
                      colorMap={CATEGORY_COLORS}
                      maxPct={maxPct}
                    />
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}

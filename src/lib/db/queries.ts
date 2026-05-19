// One-shot read functions over the local SQLite database. Reactive queries
// (rendering inside components) use `useQuery` from `@powersync/react` with
// the same SQL — these helpers exist for code paths that need a value once
// (autofill, exports, mutation pre-flight checks).
//
// Local SQLite now contains BOTH the signed-in user's data AND every followee's
// workouts/sets/exercises/profile (driven by the `followee_*` buckets in
// powersync/sync_rules.yaml — needed for the Friends feed). So every query
// that returns "my" data must filter by user_id; queries that intentionally
// span friends are explicit in their naming (e.g. `getFeedSessions`).

import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "./client";
import {
  decodeExercise,
  decodeProfile,
  decodeSet,
  decodeWorkout,
  decodeUserFieldOption,
} from "./decoders";
import type {
  ExerciseRow,
  ProfileRow,
  WorkoutRow,
  WorkoutSetRow,
  UserFieldOptionRow,
} from "./schema";
import type {
  Exercise,
  Profile,
  Workout,
  WorkoutSet,
  WorkoutWithSets,
  ExerciseHistoryEntry,
  SetWithExerciseRow,
} from "./types";

export async function getExerciseById(exerciseId: string): Promise<Exercise | null> {
  // Looked up by globally-unique id — no user filter needed; callers fetching
  // a friend's exercise (e.g. read-only session view) rely on this too.
  const row = await powersync.getOptional<ExerciseRow>(
    `SELECT * FROM exercises WHERE id = ?`,
    [exerciseId]
  );
  return row ? decodeExercise(row) : null;
}

export async function getUserExercises(): Promise<Exercise[]> {
  const userId = await getCurrentUserId();
  const rows = await powersync.getAll<ExerciseRow>(
    `SELECT * FROM exercises WHERE user_id = ? ORDER BY name ASC`,
    [userId]
  );
  return rows.map(decodeExercise);
}

// Order exercises by most recent use: latest performed_on across all the sets
// for that exercise, then latest position within that day. NULLS LAST.
export async function getUserExercisesOrderedByLastLogged(): Promise<Exercise[]> {
  const userId = await getCurrentUserId();
  const sql = `
    SELECT e.*
    FROM exercises e
    WHERE e.user_id = ?
    ORDER BY
      (SELECT MAX(w.performed_on)
       FROM sets s JOIN workouts w ON s.workout_id = w.id
       WHERE s.exercise_id = e.id AND w.user_id = e.user_id) DESC NULLS LAST,
      (SELECT MAX(s.position)
       FROM sets s JOIN workouts w ON s.workout_id = w.id
       WHERE s.exercise_id = e.id AND w.user_id = e.user_id
         AND w.performed_on = (
           SELECT MAX(w2.performed_on)
           FROM sets s2 JOIN workouts w2 ON s2.workout_id = w2.id
           WHERE s2.exercise_id = e.id AND w2.user_id = e.user_id
         )) DESC NULLS LAST
  `;
  const rows = await powersync.getAll<ExerciseRow>(sql, [userId]);
  return rows.map(decodeExercise);
}

export async function getWorkoutByDate(performedOn: string): Promise<Workout | null> {
  const userId = await getCurrentUserId();
  const row = await powersync.getOptional<WorkoutRow>(
    `SELECT * FROM workouts WHERE user_id = ? AND performed_on = ? LIMIT 1`,
    [userId, performedOn]
  );
  return row ? decodeWorkout(row) : null;
}

// Loads ANY workout (own or friend's) by id. Callers must enforce access
// boundaries themselves — e.g. the read-only friend session view passes a
// followee's workout id intentionally.
export async function getWorkoutWithSets(workoutId: string): Promise<WorkoutWithSets | null> {
  const workoutRow = await powersync.getOptional<WorkoutRow>(
    `SELECT * FROM workouts WHERE id = ?`,
    [workoutId]
  );
  if (!workoutRow) return null;
  const setRows = await powersync.getAll<WorkoutSetRow>(
    `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
    [workoutId]
  );
  return { workout: decodeWorkout(workoutRow), sets: setRows.map(decodeSet) };
}

export async function getRecentWorkouts(limit = 30): Promise<Workout[]> {
  const userId = await getCurrentUserId();
  const rows = await powersync.getAll<WorkoutRow>(
    `SELECT * FROM workouts WHERE user_id = ? ORDER BY performed_on DESC, created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map(decodeWorkout);
}

// Recent workouts with per-workout summary stats. Drives the dashboard list.
export type WorkoutWithExercises = Workout & {
  exerciseNames: string[];
  totalExercises: number;
  totalSets: number;
  totalReps: number;
};

export async function getRecentWorkoutsWithExercises(
  limit = 60,
  forUserId?: string
): Promise<WorkoutWithExercises[]> {
  // Defaults to the signed-in user. Pass `forUserId` to render a friend's
  // session list (their profile page) — same query shape, different filter.
  const userId = forUserId ?? (await getCurrentUserId());
  const workoutRows = await powersync.getAll<WorkoutRow>(
    `SELECT * FROM workouts WHERE user_id = ? ORDER BY performed_on DESC, created_at DESC LIMIT ?`,
    [userId, limit]
  );
  if (workoutRows.length === 0) return [];

  const ids = workoutRows.map((w) => w.id);
  const placeholders = ids.map(() => "?").join(",");

  // Exercise labels per workout, deduped, ordered by min(position).
  const exerciseRows = await powersync.getAll<{
    workout_id: string;
    exercise_id: string;
    exercise_name: string;
    circuit_id: string | null;
    circuit_name: string | null;
    min_position: number;
  }>(
    `SELECT
       s.workout_id, s.exercise_id, e.name AS exercise_name,
       s.circuit_id, s.circuit_name, MIN(s.position) AS min_position
     FROM sets s
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE s.workout_id IN (${placeholders})
     GROUP BY s.workout_id, s.exercise_id, e.name, s.circuit_id, s.circuit_name
     ORDER BY s.workout_id, MIN(s.position)`,
    ids
  );

  const namesByWorkout = new Map<string, string[]>();
  const exerciseCountByWorkout = new Map<string, number>();
  for (const r of exerciseRows) {
    const arr = namesByWorkout.get(r.workout_id) ?? [];
    const label = r.circuit_id ? r.circuit_name ?? "Circuit" : r.exercise_name;
    if (!arr.includes(label)) arr.push(label);
    namesByWorkout.set(r.workout_id, arr);
    exerciseCountByWorkout.set(r.workout_id, (exerciseCountByWorkout.get(r.workout_id) ?? 0) + 1);
  }

  // Per-workout totals: sets (with circuit rounds), reps (with circuit rounds * doubleReps).
  const statsRows = await powersync.getAll<{
    workout_id: string;
    total_sets: number;
    total_reps: number;
  }>(
    `SELECT
       s.workout_id,
       SUM(COALESCE(s.circuit_rounds, 1)) AS total_sets,
       SUM(
         COALESCE(s.reps, 1)
         * COALESCE(s.circuit_rounds, 1)
         * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
       ) AS total_reps
     FROM sets s
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE s.workout_id IN (${placeholders})
     GROUP BY s.workout_id`,
    ids
  );
  const statsByWorkout = new Map(statsRows.map((s) => [s.workout_id, s]));

  return workoutRows.map((w) => ({
    ...decodeWorkout(w),
    exerciseNames: namesByWorkout.get(w.id) ?? [],
    totalExercises: exerciseCountByWorkout.get(w.id) ?? 0,
    totalSets: statsByWorkout.get(w.id)?.total_sets ?? 0,
    totalReps: Number(statsByWorkout.get(w.id)?.total_reps ?? 0),
  }));
}

export async function getLastSetsForExercise(
  exerciseId: string,
  limit = 10
): Promise<Array<{ set: WorkoutSet; performedOn: string }>> {
  const userId = await getCurrentUserId();
  const rows = await powersync.getAll<WorkoutSetRow & { performed_on: string }>(
    `SELECT s.*, w.performed_on AS performed_on
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.user_id = ?
     ORDER BY w.performed_on DESC, s.position DESC
     LIMIT ?`,
    [exerciseId, userId, limit]
  );
  return rows.map((r) => ({ set: decodeSet(r), performedOn: r.performed_on }));
}

export async function getSetsWithExerciseSince(sinceIso: string): Promise<SetWithExerciseRow[]> {
  const userId = await getCurrentUserId();
  const rows = await powersync.getAll<
    WorkoutSetRow & { performed_on: string; workout_id_alias: string; exercise_json: string }
  >(
    // Fetch raw join, then decode in JS to avoid wide row aliases.
    `SELECT s.*, w.performed_on AS performed_on, w.id AS workout_id_alias
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE w.user_id = ? AND w.performed_on >= ?
     ORDER BY w.performed_on DESC`,
    [userId, sinceIso]
  );

  const exerciseIds = [...new Set(rows.map((r) => r.exercise_id).filter((v): v is string => !!v))];
  if (exerciseIds.length === 0) return [];
  const exRows = await powersync.getAll<ExerciseRow>(
    `SELECT * FROM exercises WHERE id IN (${exerciseIds.map(() => "?").join(",")})`,
    exerciseIds
  );
  const byId = new Map(exRows.map((e) => [e.id, decodeExercise(e)]));

  const out: SetWithExerciseRow[] = [];
  for (const r of rows) {
    const ex = byId.get(r.exercise_id ?? "");
    if (!ex) continue;
    out.push({
      set: decodeSet(r),
      exercise: ex,
      performedOn: r.performed_on,
      workoutId: r.workout_id_alias,
    });
  }
  return out;
}

export async function getAllSetsWithExercise(): Promise<SetWithExerciseRow[]> {
  return getSetsWithExerciseSince("0001-01-01");
}

export async function getWorkoutsInRange(
  sinceIso: string
): Promise<Array<{ performedOn: string; sessionType: string }>> {
  const userId = await getCurrentUserId();
  return powersync.getAll<{ performedOn: string; sessionType: string }>(
    `SELECT performed_on AS performedOn, session_type AS sessionType
     FROM workouts
     WHERE user_id = ? AND performed_on >= ?
     ORDER BY performed_on ASC`,
    [userId, sinceIso]
  );
}

export async function countSessionsSince(sinceIso: string): Promise<number> {
  const userId = await getCurrentUserId();
  const row = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts WHERE user_id = ? AND performed_on >= ?`,
    [userId, sinceIso]
  );
  return row.count;
}

export async function countWorkoutsSince(sinceIso: string): Promise<number> {
  const userId = await getCurrentUserId();
  const row = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts
     WHERE user_id = ? AND performed_on >= ? AND session_type = 'workout'`,
    [userId, sinceIso]
  );
  return row.count;
}

// Current consecutive-day streak. If today has no session yet, start from
// yesterday so the streak only breaks after a full day has been missed.
export async function getDayStreak(): Promise<number> {
  const userId = await getCurrentUserId();
  const rows = await powersync.getAll<{ performed_on: string }>(
    `SELECT DISTINCT performed_on FROM workouts WHERE user_id = ?`,
    [userId]
  );
  if (rows.length === 0) return 0;

  const activeDays = new Set(rows.map((r) => r.performed_on));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (!activeDays.has(toLocalIso(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (activeDays.has(toLocalIso(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// All sets the given user has logged for an exercise, oldest-first per row but
// grouped newest-workout-first. Used to compute PB badges on a friend's
// session: we need their full history, not the current user's.
export async function getExerciseSetsForUser(
  exerciseId: string,
  userId: string
): Promise<WorkoutSet[]> {
  const rows = await powersync.getAll<WorkoutSetRow & { performed_on: string }>(
    `SELECT s.*, w.performed_on AS performed_on
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.user_id = ?
     ORDER BY w.performed_on ASC, s.position ASC`,
    [exerciseId, userId]
  );
  return rows.map((r) => decodeSet(r));
}

export async function getExerciseHistory(
  exerciseId: string,
  excludeWorkoutId?: string
): Promise<ExerciseHistoryEntry[]> {
  const userId = await getCurrentUserId();
  const params: unknown[] = [exerciseId, userId];
  let exclude = "";
  if (excludeWorkoutId) {
    exclude = "AND w.id != ?";
    params.push(excludeWorkoutId);
  }
  const rows = await powersync.getAll<
    WorkoutSetRow & { workout_id_alias: string; workout_name: string; performed_on: string }
  >(
    `SELECT s.*, w.id AS workout_id_alias, w.name AS workout_name, w.performed_on AS performed_on
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.user_id = ? ${exclude}
     ORDER BY w.performed_on DESC, s.position ASC`,
    params
  );

  const byWorkout = new Map<string, ExerciseHistoryEntry>();
  const order: string[] = [];
  for (const r of rows) {
    const entry = byWorkout.get(r.workout_id_alias);
    if (entry) {
      entry.sets.push(decodeSet(r));
    } else {
      byWorkout.set(r.workout_id_alias, {
        workoutId: r.workout_id_alias,
        workoutName: r.workout_name,
        performedOn: r.performed_on,
        sets: [decodeSet(r)],
      });
      order.push(r.workout_id_alias);
    }
  }
  return order.map((id) => byWorkout.get(id)!);
}

export async function getUserFieldOptionsRaw(): Promise<UserFieldOptionRow[]> {
  const userId = await getCurrentUserId();
  return powersync.getAll<UserFieldOptionRow>(
    `SELECT * FROM user_field_options WHERE user_id = ?`,
    [userId]
  );
}

export async function getUserFieldOptions() {
  const rows = (await getUserFieldOptionsRaw()).map(decodeUserFieldOption);

  const categories = rows
    .filter((r) => r.kind === "category")
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.id, key: r.key, label: r.label, position: r.position }));
  const equipment = rows
    .filter((r) => r.kind === "equipment")
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.id, key: r.key, label: r.label, position: r.position }));

  const groupRows = rows
    .filter((r) => r.kind === "muscle_group")
    .sort((a, b) => a.position - b.position);
  const childrenByParent = new Map<string, Array<{ id: string; key: string; label: string; position: number }>>();
  for (const child of rows.filter((r) => r.kind === "muscle_child")) {
    if (!child.parentId) continue;
    const arr = childrenByParent.get(child.parentId) ?? [];
    arr.push({ id: child.id, key: child.key, label: child.label, position: child.position });
    childrenByParent.set(child.parentId, arr);
  }
  const muscleGroups = groupRows.map((g) => ({
    id: g.id,
    key: g.key,
    label: g.label,
    position: g.position,
    children: (childrenByParent.get(g.id) ?? []).sort((a, b) => a.position - b.position),
  }));

  return { categories, equipment, muscleGroups };
}

// ----- Profile stats -----
// Top-of-profile aggregates. Same multiplier rules as the per-session totals
// in getRecentWorkoutsWithExercises (circuit rounds and doubleReps both fold
// into the count). Pass any user_id — yours or a followee's.

export type UserProfileStats = {
  totalSessions: number;
  totalSets: number;
  totalReps: number;
};

export async function getUserProfileStats(userId: string): Promise<UserProfileStats> {
  const sessionsRow = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts WHERE user_id = ?`,
    [userId]
  );
  const aggRow = await powersync.get<{
    total_sets: number | null;
    total_reps: number | null;
  }>(
    `SELECT
       SUM(COALESCE(s.circuit_rounds, 1)) AS total_sets,
       SUM(
         COALESCE(s.reps, 1)
         * COALESCE(s.circuit_rounds, 1)
         * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
       ) AS total_reps
     FROM sets s
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE s.user_id = ?`,
    [userId]
  );
  return {
    totalSessions: sessionsRow.count,
    totalSets: Number(aggRow.total_sets ?? 0),
    totalReps: Number(aggRow.total_reps ?? 0),
  };
}

// ----- Friends feed -----
// Reads spanning friends' data, explicitly named so callers can't confuse
// them with "my data". The sync rules in powersync/sync_rules.yaml stream
// each followee's workouts/sets/exercises/profile into local SQLite.

export type FeedSession = {
  workoutId: string;
  userId: string;
  name: string;
  performedOn: string;
  createdAt: string;
  sessionType: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
};

// Fetches a single feed session detail (workout + sets) regardless of owner,
// alongside the author's profile snapshot for display.
export async function getFriendSessionDetail(workoutId: string): Promise<
  | {
      workout: Workout;
      sets: WorkoutSet[];
      author: Profile | null;
    }
  | null
> {
  const workoutRow = await powersync.getOptional<WorkoutRow>(
    `SELECT * FROM workouts WHERE id = ?`,
    [workoutId]
  );
  if (!workoutRow || !workoutRow.user_id) return null;

  const setRows = await powersync.getAll<WorkoutSetRow>(
    `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
    [workoutId]
  );

  const profileRow = await powersync.getOptional<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ?`,
    [workoutRow.user_id]
  );

  return {
    workout: decodeWorkout(workoutRow),
    sets: setRows.map(decodeSet),
    author: profileRow ? decodeProfile(profileRow) : null,
  };
}

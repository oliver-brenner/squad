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

import { format, parseISO, startOfWeek } from "date-fns";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "./client";
import {
  decodeExercise,
  decodeProfile,
  decodeSet,
  decodeWorkout,
  decodeUserFieldOption,
  decodeTemplate,
  decodeTemplateSet,
} from "./decoders";
import type {
  ExerciseRow,
  ProfileRow,
  WorkoutRow,
  WorkoutSetRow,
  UserFieldOptionRow,
  TemplateRow,
  TemplateSetRow,
} from "./schema";
import type {
  Exercise,
  Profile,
  Workout,
  WorkoutSet,
  WorkoutWithSets,
  ExerciseHistoryEntry,
  SetWithExerciseRow,
  TemplateWithSets,
} from "./types";
import { computeHistoricalPBs, type PBType } from "@/lib/stats/set-pbs";
import { formatSetSummary, type DistanceUnit } from "@/lib/set-format";

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

// Loads a template (owner-only) and its ordered skeleton sets. Mirrors
// getWorkoutWithSets; templates are private so callers pass their own id.
export async function getTemplateWithSets(templateId: string): Promise<TemplateWithSets | null> {
  const userId = await getCurrentUserId();
  const row = await powersync.getOptional<TemplateRow>(
    `SELECT * FROM templates WHERE id = ? AND user_id = ?`,
    [templateId, userId]
  );
  if (!row) return null;
  const setRows = await powersync.getAll<TemplateSetRow>(
    `SELECT * FROM template_sets WHERE template_id = ? ORDER BY position ASC`,
    [templateId]
  );
  return { template: decodeTemplate(row), sets: setRows.map(decodeTemplateSet) };
}

// Resolved guests for a session, ordered. On-Squad guests (guestProfileId set)
// have their name/avatar read from the locally-synced profile; off-Squad guests
// carry their stored name. Used to seed the guest editor when editing a session.
export type ResolvedSessionGuest = {
  id: string;
  guestProfileId: string | null;
  name: string;
  avatarUrl: string | null;
};

export async function getSessionGuests(workoutId: string): Promise<ResolvedSessionGuest[]> {
  const rows = await powersync.getAll<{
    id: string;
    guest_profile_id: string | null;
    guest_name: string | null;
    p_display_name: string | null;
    p_username: string | null;
    p_avatar_url: string | null;
  }>(
    `SELECT g.id, g.guest_profile_id, g.guest_name,
            p.display_name AS p_display_name, p.username AS p_username, p.avatar_url AS p_avatar_url
     FROM session_guests g
     LEFT JOIN profiles p ON p.id = g.guest_profile_id
     WHERE g.workout_id = ?
     ORDER BY g.position ASC`,
    [workoutId]
  );
  return rows.map((r) =>
    r.guest_profile_id
      ? {
          id: r.id,
          guestProfileId: r.guest_profile_id,
          name: r.p_display_name ?? r.p_username ?? "Squad member",
          avatarUrl: r.p_avatar_url,
        }
      : { id: r.id, guestProfileId: null, name: r.guest_name ?? "Guest", avatarUrl: null }
  );
}

// The id of the user's single most recent session (by date, then creation
// order), or null if they have none. Gates the live-logging "ghost set" so it
// only appears while logging the latest session, not when editing older ones.
export async function getMostRecentWorkoutId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  const row = await powersync.getOptional<{ id: string }>(
    `SELECT id FROM workouts WHERE user_id = ? ORDER BY performed_on DESC, created_at DESC LIMIT 1`,
    [userId]
  );
  return row?.id ?? null;
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
  limit = 10,
  excludeWorkoutId?: string
): Promise<Array<{ set: WorkoutSet; performedOn: string }>> {
  const userId = await getCurrentUserId();
  const params: unknown[] = [exerciseId, userId];
  let exclusion = "";
  if (excludeWorkoutId) {
    exclusion = " AND s.workout_id <> ?";
    params.push(excludeWorkoutId);
  }
  params.push(limit);
  const rows = await powersync.getAll<WorkoutSetRow & { performed_on: string }>(
    `SELECT s.*, w.performed_on AS performed_on
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.user_id = ?${exclusion}
     ORDER BY w.performed_on DESC, s.position DESC
     LIMIT ?`,
    params
  );
  return rows.map((r) => ({ set: decodeSet(r), performedOn: r.performed_on }));
}

// Returns every set from the single most recent session that logged this
// exercise, in performed order (position ascending). Unlike
// getLastSetsForExercise — which returns the last N sets newest-first and may
// span sessions — this gives a clean "what I did last time" snapshot, so the
// caller can map set i to the i-th set of the previous session (set 0 = the
// first set of that session). Empty if the exercise has no prior history.
export async function getLastSessionSetsForExercise(
  exerciseId: string,
  excludeWorkoutId?: string
): Promise<WorkoutSet[]> {
  const userId = await getCurrentUserId();
  const exclusion = excludeWorkoutId ? " AND s.workout_id <> ?" : "";
  const subExclusion = excludeWorkoutId ? " AND s2.workout_id <> ?" : "";
  const params: unknown[] = [exerciseId, userId];
  if (excludeWorkoutId) params.push(excludeWorkoutId);
  params.push(exerciseId, userId);
  if (excludeWorkoutId) params.push(excludeWorkoutId);
  const rows = await powersync.getAll<WorkoutSetRow>(
    `SELECT s.*
     FROM sets s
     INNER JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.user_id = ?${exclusion}
       AND s.workout_id = (
         SELECT s2.workout_id
         FROM sets s2
         INNER JOIN workouts w2 ON s2.workout_id = w2.id
         WHERE s2.exercise_id = ? AND w2.user_id = ?${subExclusion}
         ORDER BY w2.performed_on DESC, w2.created_at DESC
         LIMIT 1
       )
     ORDER BY s.position ASC`,
    params
  );
  return rows.map((r) => decodeSet(r));
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
  totalVolumeKg: number;
};

// Per-session aggregates over a user's full history. Powers the timeseries
// charts on the profile stats tab. Multiplier rules match getUserProfileStats:
// circuit_rounds folds into sets/reps/volume, double_reps doubles effective
// reps. Volume only counts sets that actually had weight × reps logged.
export type UserSessionAggregate = {
  performedOn: string;
  sessionType: string | null;
  totalExercises: number;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  // Session-level calories logged on the workout (not summed from sets). Null
  // when none was entered.
  calories: number | null;
};

// The user's remembered ("current") bodyweight. Bodyweight is captured per set
// in the log tray now; this profile value is what the tray pre-fills from, and
// the fallback for sets logged before `sets.bodyweight_kg` existed. Returns 0
// when unset, so callers can add it unconditionally.
export async function getProfileBodyweightKg(userId: string): Promise<number> {
  const row = await powersync.getOptional<{ bodyweight_kg: number | null }>(
    `SELECT bodyweight_kg FROM profiles WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = row?.bodyweight_kg;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// Current profile bodyweight for each of the given users, omitting anyone with
// none set. Used to resolve the display bodyweight of OTHER people's legacy
// sets: your own NULL rows are filled in on boot (see backfill.ts), but a
// followee's rows aren't yours to write, so theirs is resolved at read time
// from whatever they currently have set — the same rule
// FEED_SET_BODYWEIGHT_SQL already applies to feed volume totals.
async function getBodyweightByUser(userIds: string[]): Promise<Map<string, number>> {
  const byUser = new Map<string, number>();
  const ids = [...new Set(userIds.filter((id) => !!id))];
  if (ids.length === 0) return byUser;
  const rows = await powersync.getAll<{ id: string; bodyweight_kg: number | null }>(
    `SELECT id, bodyweight_kg FROM profiles WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  for (const r of rows) {
    const v = r.bodyweight_kg;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) byUser.set(r.id, v);
  }
  return byUser;
}

// Gives a set the author's current bodyweight when it carries no snapshot of
// its own. A set that HAS one keeps it untouched — that value is what the lifter
// actually weighed at the time, and it must not drift with their profile.
function withAuthorBodyweight(set: WorkoutSet, fallbackKg: number | undefined): WorkoutSet {
  if (set.bodyweightKg != null || fallbackKg == null) return set;
  return { ...set, bodyweightKg: fallbackKg };
}

// The bodyweight a set counts toward volume: its own snapshot, falling back to
// the profile value for pre-column sets so historical totals don't shift. `?`
// binds the fallback. Volume guards elsewhere keep a negative net load (heavy
// assistance) from subtracting from the total.
const SET_BODYWEIGHT_SQL = `CASE WHEN e.include_bodyweight = 1
    THEN COALESCE(s.bodyweight_kg, ?) ELSE 0 END`;

// Same rule for multi-author queries, where the pre-column fallback comes from
// each author's own profile row via the `profiles p` join rather than a bind.
const FEED_SET_BODYWEIGHT_SQL = `CASE WHEN e.include_bodyweight = 1
    THEN COALESCE(s.bodyweight_kg, p.bodyweight_kg, 0) ELSE 0 END`;

export async function getUserSessionAggregates(userId: string): Promise<UserSessionAggregate[]> {
  const bodyweightKg = await getProfileBodyweightKg(userId);
  const rows = await powersync.getAll<{
    performed_on: string;
    session_type: string | null;
    total_exercises: number | null;
    total_sets: number | null;
    total_reps: number | null;
    total_volume_kg: number | null;
    calories: number | null;
  }>(
    `SELECT
       w.performed_on,
       w.session_type,
       w.calories,
       COUNT(DISTINCT s.exercise_id || '|' || COALESCE(s.circuit_id, '')) AS total_exercises,
       SUM(COALESCE(s.circuit_rounds, 1)) AS total_sets,
       SUM(
         COALESCE(s.reps, 1)
         * COALESCE(s.circuit_rounds, 1)
         * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
       ) AS total_reps,
       SUM(
         CASE
           WHEN s.reps IS NOT NULL AND s.reps > 0
                AND (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                     + ${SET_BODYWEIGHT_SQL}) > 0
           THEN s.reps
                * (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                   + ${SET_BODYWEIGHT_SQL})
                * COALESCE(s.circuit_rounds, 1)
                * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
           ELSE 0
         END
       ) AS total_volume_kg
     FROM workouts w
     INNER JOIN sets s ON s.workout_id = w.id
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE w.user_id = ? AND w.session_type = 'workout'
     GROUP BY w.id, w.performed_on, w.session_type, w.calories
     ORDER BY w.performed_on ASC`,
    [bodyweightKg, bodyweightKg, userId]
  );
  return rows.map((r) => ({
    performedOn: r.performed_on,
    sessionType: r.session_type,
    totalExercises: Number(r.total_exercises ?? 0),
    totalSets: Number(r.total_sets ?? 0),
    totalReps: Number(r.total_reps ?? 0),
    totalVolumeKg: Number(r.total_volume_kg ?? 0),
    calories: r.calories,
  }));
}

// Dates of every `session_type = 'workout'` session, oldest-first. The profile
// chart buckets these into ISO weeks (Mon–Sun) in JS to plot workouts/week.
export async function getUserWorkoutDates(userId: string): Promise<string[]> {
  const rows = await powersync.getAll<{ performed_on: string }>(
    `SELECT performed_on FROM workouts
     WHERE user_id = ? AND session_type = 'workout'
     ORDER BY performed_on ASC`,
    [userId]
  );
  return rows.map((r) => r.performed_on);
}

export async function getUserProfileStats(userId: string): Promise<UserProfileStats> {
  const sessionsRow = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts WHERE user_id = ?`,
    [userId]
  );
  const bodyweightKg = await getProfileBodyweightKg(userId);
  const aggRow = await powersync.get<{
    total_sets: number | null;
    total_reps: number | null;
    total_volume_kg: number | null;
  }>(
    `SELECT
       SUM(COALESCE(s.circuit_rounds, 1)) AS total_sets,
       SUM(
         COALESCE(s.reps, 1)
         * COALESCE(s.circuit_rounds, 1)
         * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
       ) AS total_reps,
       SUM(
         CASE
           WHEN s.reps IS NOT NULL AND s.reps > 0
                AND (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                     + ${SET_BODYWEIGHT_SQL}) > 0
           THEN s.reps
                * (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                   + ${SET_BODYWEIGHT_SQL})
                * COALESCE(s.circuit_rounds, 1)
                * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
           ELSE 0
         END
       ) AS total_volume_kg
     FROM sets s
     INNER JOIN exercises e ON s.exercise_id = e.id
     WHERE s.user_id = ?`,
    [bodyweightKg, bodyweightKg, userId]
  );
  return {
    totalSessions: sessionsRow.count,
    totalSets: Number(aggRow.total_sets ?? 0),
    totalReps: Number(aggRow.total_reps ?? 0),
    totalVolumeKg: Number(aggRow.total_volume_kg ?? 0),
  };
}

// ----- Friends feed -----
// Reads spanning friends' data, explicitly named so callers can't confuse
// them with "my data". The sync rules in powersync/sync_rules.yaml stream
// each followee's workouts/sets/exercises/profile into local SQLite.
//
// The feed shows EVERY session (own or followee), PB or not — one card per
// workout, enriched with the session's stat totals, per-exercise PB / NEW
// tags, and the author's running weekly context (Nth session this week + that
// week's sets/reps/volume).

// ISO week key (Monday start) for a `YYYY-MM-DD` performed_on. Matches the
// Mon–Sun bucketing used by the dashboard and profile charts.
function isoWeekKey(performedOn: string): string {
  return format(startOfWeek(parseISO(performedOn), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export type FeedExercise = {
  exerciseId: string;
  name: string;
  // This session is the exercise's debut for the author (its first-ever log).
  isNew: boolean;
  // PB types earned in this session (metric display order). Empty = no PB.
  pbTypes: PBType[];
  // Summary of the representative PB set (the last one, read top-to-bottom),
  // or null when the exercise earned no PB this session.
  pbSetLabel: string | null;
};

export type FeedSessionEntry = {
  workoutId: string;
  authorId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  workoutName: string;
  performedOn: string;
  sessionType: string | null;
  calories: number | null;
  // Public session note (already sync-filtered — NULL if private/absent).
  note: string | null;
  totalExercises: number;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  totalPBs: number;
  exercises: FeedExercise[];
  // Weekly context for this author, ISO week (Mon–Sun) containing performedOn.
  weekSessionOrdinal: number; // 1-based: Nth session that week
  weekSessions: number;
  weekSets: number;
  weekReps: number;
  weekVolumeKg: number;
};

export async function getFeedSessions(
  currentUserId: string,
  workoutLimit = 50
): Promise<FeedSessionEntry[]> {
  // 1. Candidate headers (the rendered cards): yours + followees, newest first.
  //    All session types are kept — the feed is a full activity stream now.
  const workoutRows = await powersync.getAll<{
    id: string;
    name: string | null;
    performed_on: string;
    session_type: string | null;
    calories: number | null;
    notes: string | null;
    user_id: string;
    author_username: string | null;
    author_display_name: string | null;
    author_avatar_url: string | null;
  }>(
    `SELECT
       w.id, w.name, w.performed_on, w.session_type, w.calories, w.notes, w.user_id,
       p.username AS author_username,
       p.display_name AS author_display_name,
       p.avatar_url AS author_avatar_url
     FROM workouts w
     LEFT JOIN profiles p ON p.id = w.user_id
     WHERE w.user_id = ?
        OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ? AND f.followee_id = w.user_id
        )
     ORDER BY w.performed_on DESC, w.created_at DESC
     LIMIT ?`,
    [currentUserId, currentUserId, workoutLimit]
  );
  if (workoutRows.length === 0) return [];

  // Earliest ISO-week start among the rendered candidates — the lower bound for
  // the weekly rollup query so every shown session's week is counted in full,
  // even for sessions that fall outside the rendered window.
  let earliestWeekStart = isoWeekKey(workoutRows[0].performed_on);
  for (const w of workoutRows) {
    const wk = isoWeekKey(w.performed_on);
    if (wk < earliestWeekStart) earliestWeekStart = wk;
  }

  // 2. Per-workout stat totals over the superset window (>= earliestWeekStart).
  //    Each author's bodyweight comes from the profiles join (COALESCE handles
  //    a missing profile row), so volume is correct across multiple authors in
  //    a single query. Multiplier rules mirror getUserSessionAggregates.
  const statRows = await powersync.getAll<{
    workout_id: string;
    user_id: string;
    performed_on: string;
    created_at: string | null;
    total_exercises: number | null;
    total_sets: number | null;
    total_reps: number | null;
    total_volume_kg: number | null;
  }>(
    `SELECT
       w.id AS workout_id, w.user_id, w.performed_on, w.created_at,
       COUNT(DISTINCT s.exercise_id || '|' || COALESCE(s.circuit_id, '')) AS total_exercises,
       SUM(COALESCE(s.circuit_rounds, 1)) AS total_sets,
       SUM(
         COALESCE(s.reps, 1)
         * COALESCE(s.circuit_rounds, 1)
         * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
       ) AS total_reps,
       SUM(
         CASE
           WHEN s.reps IS NOT NULL AND s.reps > 0
                AND (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                     + ${FEED_SET_BODYWEIGHT_SQL}) > 0
           THEN s.reps
                * (COALESCE(s.weight_kg, 0) + COALESCE(e.default_weight_kg, 0)
                   + ${FEED_SET_BODYWEIGHT_SQL})
                * COALESCE(s.circuit_rounds, 1)
                * CASE WHEN e.double_reps = 1 THEN 2 ELSE 1 END
           ELSE 0
         END
       ) AS total_volume_kg
     FROM workouts w
     INNER JOIN sets s ON s.workout_id = w.id
     INNER JOIN exercises e ON s.exercise_id = e.id
     LEFT JOIN profiles p ON p.id = w.user_id
     WHERE (w.user_id = ?
            OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = w.user_id))
       AND w.performed_on >= ?
     GROUP BY w.id, w.user_id, w.performed_on, w.created_at`,
    [currentUserId, currentUserId, earliestWeekStart]
  );

  type WorkoutStat = {
    workoutId: string;
    userId: string;
    performedOn: string;
    createdAt: string;
    exercises: number;
    sets: number;
    reps: number;
    volumeKg: number;
  };
  const statsByWorkout = new Map<string, WorkoutStat>();
  for (const r of statRows) {
    statsByWorkout.set(r.workout_id, {
      workoutId: r.workout_id,
      userId: r.user_id,
      performedOn: r.performed_on,
      createdAt: r.created_at ?? "",
      exercises: Number(r.total_exercises ?? 0),
      sets: Number(r.total_sets ?? 0),
      reps: Number(r.total_reps ?? 0),
      volumeKg: Number(r.total_volume_kg ?? 0),
    });
  }

  // Weekly rollup per (author, ISO week): summed totals + the week's workouts
  // ordered chronologically so each can be assigned a 1-based session ordinal.
  type WeekRollup = {
    sessions: number;
    sets: number;
    reps: number;
    volumeKg: number;
    workouts: WorkoutStat[];
  };
  const weekKeyFor = (userId: string, performedOn: string) =>
    `${userId}::${isoWeekKey(performedOn)}`;
  const weekly = new Map<string, WeekRollup>();
  for (const st of statsByWorkout.values()) {
    const key = weekKeyFor(st.userId, st.performedOn);
    const roll =
      weekly.get(key) ?? { sessions: 0, sets: 0, reps: 0, volumeKg: 0, workouts: [] };
    roll.sessions += 1;
    roll.sets += st.sets;
    roll.reps += st.reps;
    roll.volumeKg += st.volumeKg;
    roll.workouts.push(st);
    weekly.set(key, roll);
  }
  const ordinalByWorkout = new Map<string, number>();
  for (const roll of weekly.values()) {
    roll.workouts.sort((a, b) =>
      a.performedOn === b.performedOn
        ? a.createdAt.localeCompare(b.createdAt)
        : a.performedOn.localeCompare(b.performedOn)
    );
    roll.workouts.forEach((w, i) => ordinalByWorkout.set(w.workoutId, i + 1));
  }

  // 3. Sets within the rendered workouts, and the exercises they reference.
  const workoutIds = workoutRows.map((w) => w.id);
  const placeholders = workoutIds.map(() => "?").join(",");
  const candidateSetRows = await powersync.getAll<WorkoutSetRow>(
    `SELECT * FROM sets WHERE workout_id IN (${placeholders})`,
    workoutIds
  );
  // Display bodyweight for each author's legacy sets — the feed mixes authors,
  // so the fallback is per-author rather than a single value.
  const bodyweightByUser = await getBodyweightByUser(workoutRows.map((w) => w.user_id));
  const exerciseIds = [
    ...new Set(candidateSetRows.map((r) => r.exercise_id).filter((v): v is string => !!v)),
  ];
  const exerciseMap = new Map<string, Exercise>();
  if (exerciseIds.length > 0) {
    const exRows = await powersync.getAll<ExerciseRow>(
      `SELECT * FROM exercises WHERE id IN (${exerciseIds.map(() => "?").join(",")})`,
      exerciseIds
    );
    for (const r of exRows) exerciseMap.set(r.id, decodeExercise(r));
  }

  // 4. Historical PBs + debut workout per distinct (user_id, exercise_id) pair,
  //    using each owner's FULL history — not just the candidate window.
  const pairs = new Set<string>();
  for (const r of candidateSetRows) {
    if (r.user_id && r.exercise_id) pairs.add(`${r.user_id}::${r.exercise_id}`);
  }
  const pbBySetId = new Map<string, PBType[]>();
  const debutWorkoutByPair = new Map<string, string>();
  await Promise.all(
    [...pairs].map(async (key) => {
      const sep = key.indexOf("::");
      const userId = key.slice(0, sep);
      const exerciseId = key.slice(sep + 2);
      const exercise = exerciseMap.get(exerciseId);
      if (!exercise) return;
      const history = await getExerciseSetsForUser(exerciseId, userId);
      if (history.length === 0) return;
      // history is ordered oldest-first, so its first set marks the debut.
      debutWorkoutByPair.set(key, history[0].workoutId);
      // Suppress PBs on a user's first-ever log of an exercise — the very first
      // session trivially sets every record, which isn't a meaningful
      // achievement. That session earns a NEW tag instead. Require ≥2 workouts.
      const distinctWorkouts = new Set(history.map((s) => s.workoutId)).size;
      if (distinctWorkouts < 2) return;
      const pbs = computeHistoricalPBs(history, exercise);
      history.forEach((s, i) => {
        if (pbs[i].length > 0) pbBySetId.set(s.id, pbs[i]);
      });
    })
  );

  // Group the rendered workouts' sets by workout.
  const setsByWorkout = new Map<string, WorkoutSetRow[]>();
  for (const r of candidateSetRows) {
    const wid = r.workout_id ?? "";
    const arr = setsByWorkout.get(wid) ?? [];
    arr.push(r);
    setsByWorkout.set(wid, arr);
  }

  // 5. Assemble one entry per candidate workout (no PB gate).
  const result: FeedSessionEntry[] = [];
  for (const w of workoutRows) {
    const rows = setsByWorkout.get(w.id) ?? [];

    // Group this workout's sets by exercise, preserving logged order.
    const byExercise = new Map<string, WorkoutSetRow[]>();
    for (const r of rows) {
      if (!r.exercise_id) continue;
      const arr = byExercise.get(r.exercise_id) ?? [];
      arr.push(r);
      byExercise.set(r.exercise_id, arr);
    }
    // Render exercises in the order they were logged (earliest set position).
    const orderedExerciseIds = [...byExercise.keys()].sort((a, b) => {
      const aPos = Math.min(...byExercise.get(a)!.map((r) => r.position ?? 0));
      const bPos = Math.min(...byExercise.get(b)!.map((r) => r.position ?? 0));
      return aPos - bPos;
    });

    const exercises: FeedExercise[] = [];
    let totalPBs = 0;
    for (const exId of orderedExerciseIds) {
      const exercise = exerciseMap.get(exId);
      if (!exercise) continue;
      const exRows = [...byExercise.get(exId)!].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );

      // Within one session, only the LAST set per PB type keeps the badge.
      // Walking newest → oldest, each type is claimed once.
      const keptByRow = new Map<string, PBType[]>();
      const claimed = new Set<PBType>();
      for (let i = exRows.length - 1; i >= 0; i--) {
        const all = pbBySetId.get(exRows[i].id) ?? [];
        const kept = all.filter((t) => {
          if (claimed.has(t)) return false;
          claimed.add(t);
          return true;
        });
        if (kept.length > 0) keptByRow.set(exRows[i].id, kept);
      }

      // Union kept types (metric order) + the representative PB set label — the
      // last PB set read top-to-bottom.
      const pbTypes: PBType[] = [];
      let pbSetLabel: string | null = null;
      for (const r of exRows) {
        const kept = keptByRow.get(r.id);
        if (!kept) continue;
        for (const t of kept) if (!pbTypes.includes(t)) pbTypes.push(t);
        totalPBs += kept.length;
        pbSetLabel = formatSetSummary(
          withAuthorBodyweight(decodeSet(r), bodyweightByUser.get(w.user_id)),
          exercise,
          (exercise.distanceUnit ?? "km") as DistanceUnit
        );
      }

      exercises.push({
        exerciseId: exId,
        name: exercise.name,
        isNew: debutWorkoutByPair.get(`${w.user_id}::${exId}`) === w.id,
        pbTypes,
        pbSetLabel: pbTypes.length > 0 ? pbSetLabel : null,
      });
    }

    const stat = statsByWorkout.get(w.id);
    const roll = weekly.get(weekKeyFor(w.user_id, w.performed_on));

    result.push({
      workoutId: w.id,
      authorId: w.user_id,
      authorUsername: w.author_username,
      authorDisplayName: w.author_display_name,
      authorAvatarUrl: w.author_avatar_url,
      workoutName: w.name ?? "",
      performedOn: w.performed_on,
      sessionType: w.session_type,
      calories: w.calories,
      note: w.notes && w.notes.trim().length > 0 ? w.notes : null,
      totalExercises: stat?.exercises ?? 0,
      totalSets: stat?.sets ?? 0,
      totalReps: stat?.reps ?? 0,
      totalVolumeKg: stat?.volumeKg ?? 0,
      totalPBs,
      exercises,
      weekSessionOrdinal: ordinalByWorkout.get(w.id) ?? 1,
      weekSessions: roll?.sessions ?? 1,
      weekSets: roll?.sets ?? 0,
      weekReps: roll?.reps ?? 0,
      weekVolumeKg: roll?.volumeKg ?? 0,
    });
  }

  return result;
}

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

  // The author's own legacy sets can't be backfilled (they're not our rows to
  // write), so their bodyweight is resolved here from the profile we just read.
  const authorBodyweightKg =
    typeof profileRow?.bodyweight_kg === "number" &&
    Number.isFinite(profileRow.bodyweight_kg) &&
    profileRow.bodyweight_kg > 0
      ? profileRow.bodyweight_kg
      : undefined;

  return {
    workout: decodeWorkout(workoutRow),
    sets: setRows.map((r) => withAuthorBodyweight(decodeSet(r), authorBodyweightKg)),
    author: profileRow ? decodeProfile(profileRow) : null,
  };
}

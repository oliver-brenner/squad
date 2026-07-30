import { z } from "zod";
import type { Transaction } from "@powersync/web";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { arrStr, boolInt, nowISO, uuid, variationsStr } from "@/lib/db/encoding";
import { decodeExercise } from "@/lib/db/decoders";
import type {
  ExerciseRow,
  UserFieldKind,
  UserFieldOptionRow,
} from "@/lib/db/schema";

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  categories: z.array(z.string().min(1).max(80)).nullable().optional(),
  equipment: z.string().nullable().optional(),
  isBodyweight: z.boolean(),
  includeBodyweight: z.boolean(),
  trackReps: z.boolean(),
  defaultWeightKg: z.number().min(0).max(1000),
  doubleReps: z.boolean(),
  distanceUnit: z.enum(["m", "km", "yd"]).nullable().optional(),
  trackTime: z.boolean(),
  timeUnit: z.enum(["h", "min", "sec"]).nullable().optional(),
  trackResistance: z.boolean(),
  trackSpeed: z.boolean(),
  speedUnit: z.enum(["ms", "kmh"]).nullable().optional(),
  trackIncline: z.boolean(),
  inclineUnit: z.enum(["pct", "setting"]).nullable().optional(),
  trackRest: z.boolean(),
  trackCalories: z.boolean(),
  trackRpe: z.boolean(),
  trackSteps: z.boolean(),
  heightUnit: z.enum(["cm", "m", "in", "ft"]).nullable().optional(),
  muscles: z.array(z.string()).nullable().optional(),
  secondaryMuscles: z.array(z.string()).nullable().optional(),
  variations: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(80),
      })
    )
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function createExercise(input: z.infer<typeof exerciseSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const data = exerciseSchema.parse(input);
  const id = uuid();
  const now = nowISO();

  await powersync.execute(
    `INSERT INTO exercises (
      id, user_id, name, categories, equipment,
      is_bodyweight, include_bodyweight, track_reps, default_weight_kg, double_reps,
      distance_unit, track_time, time_unit,
      track_resistance, track_speed, speed_unit,
      track_incline, incline_unit, track_rest, track_calories, track_rpe,
      track_steps, height_unit,
      muscles, secondary_muscles, variations, notes, created_at
    ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?,  ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      data.name,
      arrStr(data.categories ?? null),
      data.equipment ?? null,
      boolInt(data.isBodyweight),
      boolInt(data.includeBodyweight),
      boolInt(data.trackReps),
      data.defaultWeightKg,
      boolInt(data.doubleReps),
      data.distanceUnit ?? null,
      boolInt(data.trackTime),
      data.timeUnit ?? null,
      boolInt(data.trackResistance),
      boolInt(data.trackSpeed),
      data.speedUnit ?? null,
      boolInt(data.trackIncline),
      data.inclineUnit ?? null,
      boolInt(data.trackRest),
      boolInt(data.trackCalories),
      boolInt(data.trackRpe),
      boolInt(data.trackSteps),
      data.heightUnit ?? null,
      arrStr(data.muscles ?? null),
      arrStr(data.secondaryMuscles ?? null),
      variationsStr(data.variations ?? null),
      data.notes ?? null,
      now,
    ]
  );
  return id;
}

export async function updateExercise(
  id: string,
  input: z.infer<typeof exerciseSchema>
): Promise<void> {
  const userId = await getCurrentUserId();
  const data = exerciseSchema.parse(input);

  await powersync.execute(
    `UPDATE exercises SET
      name = ?, categories = ?, equipment = ?,
      is_bodyweight = ?, include_bodyweight = ?, track_reps = ?, default_weight_kg = ?, double_reps = ?,
      distance_unit = ?, track_time = ?, time_unit = ?,
      track_resistance = ?, track_speed = ?, speed_unit = ?,
      track_incline = ?, incline_unit = ?, track_rest = ?, track_calories = ?, track_rpe = ?,
      track_steps = ?, height_unit = ?,
      muscles = ?, secondary_muscles = ?, variations = ?, notes = ?
     WHERE id = ? AND user_id = ?`,
    [
      data.name,
      arrStr(data.categories ?? null),
      data.equipment ?? null,
      boolInt(data.isBodyweight),
      boolInt(data.includeBodyweight),
      boolInt(data.trackReps),
      data.defaultWeightKg,
      boolInt(data.doubleReps),
      data.distanceUnit ?? null,
      boolInt(data.trackTime),
      data.timeUnit ?? null,
      boolInt(data.trackResistance),
      boolInt(data.trackSpeed),
      data.speedUnit ?? null,
      boolInt(data.trackIncline),
      data.inclineUnit ?? null,
      boolInt(data.trackRest),
      boolInt(data.trackCalories),
      boolInt(data.trackRpe),
      boolInt(data.trackSteps),
      data.heightUnit ?? null,
      arrStr(data.muscles ?? null),
      arrStr(data.secondaryMuscles ?? null),
      variationsStr(data.variations ?? null),
      data.notes ?? null,
      id,
      userId,
    ]
  );
}

// Focused write for the inline edit-note UX in the workout editor (tapping
// a note or "Edit note" in the 3-dots tray). Keeps autosave off the hot path
// of the editor's bigger save flow.
export async function updateExerciseNotes(id: string, notes: string | null): Promise<void> {
  const userId = await getCurrentUserId();
  const trimmed = notes && notes.trim().length > 0 ? notes : null;
  await powersync.execute(
    `UPDATE exercises SET notes = ? WHERE id = ? AND user_id = ?`,
    [trimmed, id, userId]
  );
}

// Counts the user's own sets that reference this exercise. UI uses this to
// warn before a hard delete that wipes historical references too.
export async function countSetsForExercise(id: string): Promise<number> {
  const userId = await getCurrentUserId();
  const row = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sets WHERE exercise_id = ? AND user_id = ?`,
    [id, userId]
  );
  return row.count;
}

// What the default-weight confirmation tray needs to know about an exercise's
// history: how many of the user's own sets carry an ENTERED weight (reps-only
// sets have nothing to shift, so they're excluded and left untouched), plus the
// most recently logged weight — used for the one concrete example in the tray
// copy. `latestWeightKg` is a single real set rather than a summary, so it
// stays truthful when the past sets all have different values.
export type WeightedSetHistory = {
  count: number;
  latestWeightKg: number | null;
};

export async function getWeightedSetHistory(
  exerciseId: string
): Promise<WeightedSetHistory> {
  const userId = await getCurrentUserId();
  const row = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sets
     WHERE exercise_id = ? AND user_id = ? AND weight_kg IS NOT NULL`,
    [exerciseId, userId]
  );
  const latest = await powersync.getOptional<{ weight_kg: number | null }>(
    `SELECT s.weight_kg FROM sets s
     WHERE s.exercise_id = ? AND s.user_id = ? AND s.weight_kg IS NOT NULL
     ORDER BY s.performed_on DESC, s.position DESC
     LIMIT 1`,
    [exerciseId, userId]
  );
  return { count: row.count, latestWeightKg: latest?.weight_kg ?? null };
}

// Re-expresses historical sets after an exercise's default weight changed.
//
// A set's total load is `weight_kg + default_weight_kg` (see set-format), so
// switching a 20 kg default on would silently re-read every past set as 20 kg
// heavier than it was — those sets were entered as the TOTAL, because there was
// no default to add. Subtracting the delta from each entered weight restores
// the original total: a logged 100 becomes 80+20. Removing the default adds it
// back, so the two directions are exact inverses and PBs/volume don't move
// (records score on weight_kg + default too — see recordLoadKg).
//
// `deltaKg` is (new default − old default). Reps-only sets are skipped. A
// result may legitimately go negative: 15 kg logged against a new 20 kg default
// becomes -5+20, which is exactly the assistance convention weight_kg already
// uses. template_sets carry weight_kg against an exercise as well, so they
// shift in the same transaction — otherwise templates would keep seeding new
// sessions in the old convention.
export async function adjustSetWeightsForDefaultChange(
  exerciseId: string,
  deltaKg: number
): Promise<void> {
  if (!Number.isFinite(deltaKg) || deltaKg === 0) return;
  const userId = await getCurrentUserId();
  await powersync.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE sets SET weight_kg = ROUND(weight_kg - ?, 2)
       WHERE exercise_id = ? AND user_id = ? AND weight_kg IS NOT NULL`,
      [deltaKg, exerciseId, userId]
    );
    await tx.execute(
      `UPDATE template_sets SET weight_kg = ROUND(weight_kg - ?, 2)
       WHERE exercise_id = ? AND user_id = ? AND weight_kg IS NOT NULL`,
      [deltaKg, exerciseId, userId]
    );
  });
}

// Hard delete. Sets referencing this exercise are removed first so the
// exercise vanishes from past sessions too — matches the user-confirmed
// "disappears from those sessions and the exercise list" behaviour.
export async function deleteExercise(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  await powersync.writeTransaction(async (tx) => {
    await tx.execute(
      `DELETE FROM sets WHERE exercise_id = ? AND user_id = ?`,
      [id, userId]
    );
    await tx.execute(
      `DELETE FROM exercises WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
  });
}

// Copies a friend's exercise into the signed-in user's library. The exercise
// keeps its name, tracking settings, and all tag KEYS (categories,
// equipment, muscles, secondary muscles). For any tag key the user doesn't
// already have, a matching `user_field_options` row is created — sourced
// from the friend's row so the LABEL the friend chose comes along too.
// Muscle children backfill their parent muscle group when needed.
const copyFromFriendSchema = z.object({ sourceExerciseId: z.string().uuid() });

export async function copyExerciseFromFriend(
  input: z.infer<typeof copyFromFriendSchema>
): Promise<string> {
  const myUserId = await getCurrentUserId();
  const { sourceExerciseId } = copyFromFriendSchema.parse(input);

  let newId = "";
  await powersync.writeTransaction(async (tx) => {
    newId = await copyExerciseInTx(tx, myUserId, sourceExerciseId);
  });
  return newId;
}

// Transaction-internal variant. Used directly by `copyFriendSession` so the
// whole "copy missing exercises + insert workout + insert sets" runs as a
// single atomic write — no orphan exercises if the workout insert fails.
// All reads go through `tx` to share the transaction's snapshot.
export async function copyExerciseInTx(
  tx: Transaction,
  myUserId: string,
  sourceExerciseId: string
): Promise<string> {
  const sourceRow = await tx.getOptional<ExerciseRow>(
    `SELECT * FROM exercises WHERE id = ?`,
    [sourceExerciseId]
  );
  if (!sourceRow) throw new Error("Exercise not found");
  const source = decodeExercise(sourceRow);
  if (!source.userId) throw new Error("Exercise has no owner");
  if (source.userId === myUserId) {
    throw new Error("That exercise is already in your library");
  }

  const friendOptions = await tx.getAll<UserFieldOptionRow>(
    `SELECT * FROM user_field_options WHERE user_id = ?`,
    [source.userId]
  );

  // Friend lookups by id (for resolving muscle_child.parent_id → group row)
  // and by key (with multiple rows possible if a key collides across kinds).
  const friendById = new Map<string, UserFieldOptionRow>();
  const friendByKey = new Map<string, UserFieldOptionRow[]>();
  for (const r of friendOptions) {
    friendById.set(r.id, r);
    const k = r.key ?? "";
    if (!k) continue;
    const arr = friendByKey.get(k) ?? [];
    arr.push(r);
    friendByKey.set(k, arr);
  }

  // Categories — flat, just ensure each key.
  for (const k of source.categories ?? []) {
    const f = pickFriendOption(friendByKey, k, "category");
    await ensureMineHasOption(tx, myUserId, "category", k, f?.label ?? k, null);
  }

  // Equipment — single key.
  if (source.equipment) {
    const f = pickFriendOption(friendByKey, source.equipment, "equipment");
    await ensureMineHasOption(
      tx,
      myUserId,
      "equipment",
      source.equipment,
      f?.label ?? source.equipment,
      null
    );
  }

  // Muscles — key can refer to either a muscle_group or muscle_child. For
  // children we have to backfill the parent group first so we know the
  // correct local parent_id to attach the child under.
  const allMuscleKeys = [
    ...new Set([...(source.muscles ?? []), ...(source.secondaryMuscles ?? [])]),
  ];
  for (const k of allMuscleKeys) {
    const groupOpt = pickFriendOption(friendByKey, k, "muscle_group");
    if (groupOpt) {
      await ensureMineHasOption(tx, myUserId, "muscle_group", k, groupOpt.label ?? k, null);
      continue;
    }
    const childOpt = pickFriendOption(friendByKey, k, "muscle_child");
    if (!childOpt || !childOpt.parent_id) continue;
    const parentOpt = friendById.get(childOpt.parent_id);
    if (!parentOpt || !parentOpt.key) continue;
    const myParentId = await ensureMineHasOption(
      tx,
      myUserId,
      "muscle_group",
      parentOpt.key,
      parentOpt.label ?? parentOpt.key,
      null
    );
    await ensureMineHasOption(
      tx,
      myUserId,
      "muscle_child",
      k,
      childOpt.label ?? k,
      myParentId
    );
  }

  // Variations belong to the exercise (key + label), so they copy verbatim
  // with the rest of the row — no field-options backfill needed.

  // Insert the exercise. Tag keys are preserved verbatim — the ensure calls
  // above guarantee each key now exists in my options too.
  const newId = uuid();
  await tx.execute(
    `INSERT INTO exercises (
      id, user_id, name, categories, equipment,
      is_bodyweight, include_bodyweight, track_reps, default_weight_kg, double_reps,
      distance_unit, track_time, time_unit,
      track_resistance, track_speed, speed_unit,
      track_incline, incline_unit, track_rest, track_calories, track_rpe,
      track_steps, height_unit,
      muscles, secondary_muscles, variations, created_at
    ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?,  ?, ?, ?, ?)`,
    [
      newId,
      myUserId,
      source.name,
      arrStr(source.categories ?? null),
      source.equipment ?? null,
      boolInt(source.isBodyweight),
      boolInt(source.includeBodyweight),
      boolInt(source.trackReps),
      source.defaultWeightKg,
      boolInt(source.doubleReps),
      source.distanceUnit ?? null,
      boolInt(source.trackTime),
      source.timeUnit ?? null,
      boolInt(source.trackResistance),
      boolInt(source.trackSpeed),
      source.speedUnit ?? null,
      boolInt(source.trackIncline),
      source.inclineUnit ?? null,
      boolInt(source.trackRest),
      boolInt(source.trackCalories),
      boolInt(source.trackRpe),
      boolInt(source.trackSteps),
      source.heightUnit ?? null,
      arrStr(source.muscles ?? null),
      arrStr(source.secondaryMuscles ?? null),
      variationsStr(source.variations ?? null),
      nowISO(),
    ]
  );

  return newId;
}

// Picks the friend's option row matching a (key, kind) pair. The same key
// can legally exist across multiple kinds (and across muscle_child parents);
// the first match for the requested kind is good enough for label lookup.
function pickFriendOption(
  byKey: Map<string, UserFieldOptionRow[]>,
  key: string,
  kind: UserFieldKind
): UserFieldOptionRow | null {
  const matches = byKey.get(key) ?? [];
  return matches.find((r) => r.kind === kind) ?? null;
}

// Idempotent insert into my user_field_options. Returns the existing or new
// row id. Position defaults to the end of my list for that (kind, parent).
async function ensureMineHasOption(
  tx: Transaction,
  myUserId: string,
  kind: UserFieldKind,
  key: string,
  label: string,
  parentIdInMine: string | null
): Promise<string> {
  const existing = parentIdInMine
    ? await tx.getOptional<{ id: string }>(
        `SELECT id FROM user_field_options
         WHERE user_id = ? AND kind = ? AND parent_id = ? AND key = ?
         LIMIT 1`,
        [myUserId, kind, parentIdInMine, key]
      )
    : await tx.getOptional<{ id: string }>(
        `SELECT id FROM user_field_options
         WHERE user_id = ? AND kind = ? AND parent_id IS NULL AND key = ?
         LIMIT 1`,
        [myUserId, kind, key]
      );
  if (existing) return existing.id;

  const positionRows = parentIdInMine
    ? await tx.getAll<{ position: number }>(
        `SELECT position FROM user_field_options
         WHERE user_id = ? AND kind = ? AND parent_id = ?`,
        [myUserId, kind, parentIdInMine]
      )
    : await tx.getAll<{ position: number }>(
        `SELECT position FROM user_field_options
         WHERE user_id = ? AND kind = ? AND parent_id IS NULL`,
        [myUserId, kind]
      );
  const nextPosition =
    positionRows.length === 0
      ? 0
      : Math.max(...positionRows.map((r) => r.position ?? 0)) + 1;

  const newId = uuid();
  await tx.execute(
    `INSERT INTO user_field_options
       (id, user_id, kind, parent_id, key, label, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId, myUserId, kind, parentIdInMine, key, label, nextPosition, nowISO()]
  );
  return newId;
}

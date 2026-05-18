import { z } from "zod";
import type { Transaction } from "@powersync/web";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { arrStr, boolInt, nowISO, uuid } from "@/lib/db/encoding";
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
  muscles: z.array(z.string()).nullable().optional(),
  secondaryMuscles: z.array(z.string()).nullable().optional(),
});

export async function createExercise(input: z.infer<typeof exerciseSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const data = exerciseSchema.parse(input);
  const id = uuid();
  const now = nowISO();

  await powersync.execute(
    `INSERT INTO exercises (
      id, user_id, name, categories, equipment,
      is_bodyweight, track_reps, default_weight_kg, double_reps,
      distance_unit, track_time, time_unit,
      track_resistance, track_speed, speed_unit,
      track_incline, incline_unit, track_rest,
      muscles, secondary_muscles, archived_at, created_at
    ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?)`,
    [
      id,
      userId,
      data.name,
      arrStr(data.categories ?? null),
      data.equipment ?? null,
      boolInt(data.isBodyweight),
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
      arrStr(data.muscles ?? null),
      arrStr(data.secondaryMuscles ?? null),
      null,
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
      is_bodyweight = ?, track_reps = ?, default_weight_kg = ?, double_reps = ?,
      distance_unit = ?, track_time = ?, time_unit = ?,
      track_resistance = ?, track_speed = ?, speed_unit = ?,
      track_incline = ?, incline_unit = ?, track_rest = ?,
      muscles = ?, secondary_muscles = ?
     WHERE id = ? AND user_id = ?`,
    [
      data.name,
      arrStr(data.categories ?? null),
      data.equipment ?? null,
      boolInt(data.isBodyweight),
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
      arrStr(data.muscles ?? null),
      arrStr(data.secondaryMuscles ?? null),
      id,
      userId,
    ]
  );
}

export async function archiveExercise(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  await powersync.execute(
    `UPDATE exercises SET archived_at = ? WHERE id = ? AND user_id = ?`,
    [nowISO(), id, userId]
  );
}

export async function unarchiveExercise(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  await powersync.execute(
    `UPDATE exercises SET archived_at = NULL WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
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

  const sourceRow = await powersync.getOptional<ExerciseRow>(
    `SELECT * FROM exercises WHERE id = ?`,
    [sourceExerciseId]
  );
  if (!sourceRow) throw new Error("Exercise not found");
  const source = decodeExercise(sourceRow);
  if (!source.userId) throw new Error("Exercise has no owner");
  if (source.userId === myUserId) {
    throw new Error("That exercise is already in your library");
  }

  // Pull both libraries up-front. Local SQLite — followee_field_options keeps
  // the friend's options synced for as long as we follow them.
  const friendOptions = await powersync.getAll<UserFieldOptionRow>(
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

  const newId = uuid();

  await powersync.writeTransaction(async (tx) => {
    // Categories — flat, just ensure each key.
    for (const k of source.categories ?? []) {
      const f = pickFriendOption(friendByKey, k, "category");
      if (f) {
        await ensureMineHasOption(tx, myUserId, "category", k, f.label ?? k, null);
      } else {
        // Friend has the key on the exercise but no matching option row.
        // Still create one in mine using the raw key as the label.
        await ensureMineHasOption(tx, myUserId, "category", k, k, null);
      }
    }

    // Equipment — single key.
    if (source.equipment) {
      const f = pickFriendOption(friendByKey, source.equipment, "equipment");
      const label = f?.label ?? source.equipment;
      await ensureMineHasOption(tx, myUserId, "equipment", source.equipment, label, null);
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

    // Finally, insert the exercise. Tag keys are preserved verbatim — the
    // ensure calls above guarantee each key now exists in my options too.
    await tx.execute(
      `INSERT INTO exercises (
        id, user_id, name, categories, equipment,
        is_bodyweight, track_reps, default_weight_kg, double_reps,
        distance_unit, track_time, time_unit,
        track_resistance, track_speed, speed_unit,
        track_incline, incline_unit, track_rest,
        muscles, secondary_muscles, archived_at, created_at
      ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?)`,
      [
        newId,
        myUserId,
        source.name,
        arrStr(source.categories ?? null),
        source.equipment ?? null,
        boolInt(source.isBodyweight),
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
        arrStr(source.muscles ?? null),
        arrStr(source.secondaryMuscles ?? null),
        null,
        nowISO(),
      ]
    );
  });

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

import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { nowISO, uuid } from "@/lib/db/encoding";
import type { ExerciseRow, WorkoutRow, WorkoutSetRow } from "@/lib/db/schema";
import { copyExerciseInTx } from "@/lib/mutations/exercises";

const setInputSchema = z.object({
  id: z.string().uuid().optional(),
  exerciseId: z.string().uuid(),
  position: z.number().int().min(0),
  reps: z.number().int().min(0).max(10_000).nullable(),
  weightKg: z.number().min(0).max(2000).nullable(),
  distanceKm: z.number().min(0).max(1000).nullable(),
  durationSec: z.number().int().min(0).max(86400).nullable(),
  resistance: z.number().int().min(0).max(100).nullable(),
  speedMs: z.number().min(0).max(100).nullable(),
  inclinePct: z.number().min(-50).max(50).nullable(),
  restSec: z.number().int().min(0).max(3600).nullable(),
  calories: z.number().int().min(0).max(100_000).nullable(),
  circuitId: z.string().uuid().nullable().optional(),
  circuitRounds: z.number().int().min(0).max(999).nullable().optional(),
  circuitName: z.string().trim().max(80).nullable().optional(),
});

const workoutInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(2000).nullable().optional(),
  sets: z.array(setInputSchema),
});

// Save a workout and replace its set list in one transaction.
// Same single-entry-point pattern as gymtracker's saveWorkout.
export async function saveWorkout(input: z.infer<typeof workoutInputSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = workoutInputSchema.parse(input);
  const now = nowISO();
  const workoutId = parsed.id ?? uuid();

  await powersync.writeTransaction(async (tx) => {
    if (parsed.id) {
      await tx.execute(
        `UPDATE workouts SET name = ?, performed_on = ?, notes = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [parsed.name, parsed.performedOn, parsed.notes ?? null, now, parsed.id, userId]
      );
    } else {
      await tx.execute(
        `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [workoutId, userId, parsed.name, parsed.performedOn, "workout", parsed.notes ?? null, now, now]
      );
    }

    await tx.execute(`DELETE FROM sets WHERE workout_id = ?`, [workoutId]);

    for (const s of parsed.sets) {
      await tx.execute(
        `INSERT INTO sets (
          id, user_id, performed_on, workout_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories,
          circuit_id, circuit_rounds, circuit_name
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?)`,
        [
          s.id ?? uuid(),
          userId,
          parsed.performedOn,
          workoutId,
          s.exerciseId,
          s.position,
          s.reps,
          s.weightKg,
          s.distanceKm,
          s.durationSec,
          s.resistance,
          s.speedMs,
          s.inclinePct,
          s.restSec,
          s.calories ?? null,
          s.circuitId ?? null,
          s.circuitRounds ?? null,
          s.circuitName ?? null,
        ]
      );
    }
  });

  return workoutId;
}

// A guest is either an on-Squad user (profileId set) or an off-Squad person
// (name set). Exactly one of the two identifies them.
const guestInputSchema = z
  .object({
    profileId: z.string().uuid().optional(),
    name: z.string().trim().max(80).optional(),
  })
  .refine((g) => !!g.profileId || !!g.name?.trim(), {
    message: "A guest needs either a profileId or a name",
  });

export type GuestInput = z.infer<typeof guestInputSchema>;

// Inserts the guest rows for a workout inside an existing transaction. user_id
// is the session owner (the signed-in user) — denormalised so sync buckets can
// filter without joining workouts.
async function insertGuestsInTx(
  tx: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  ownerId: string,
  workoutId: string,
  guests: GuestInput[]
): Promise<void> {
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    await tx.execute(
      `INSERT INTO session_guests (id, user_id, workout_id, guest_profile_id, guest_name, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        ownerId,
        workoutId,
        g.profileId ?? null,
        g.profileId ? null : g.name?.trim() ?? null,
        i,
        nowISO(),
      ]
    );
  }
}

const createWorkoutSchema = z.object({
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: z.enum(["workout", "stretch", "sport", "lifestyle"]).optional().default("workout"),
  guests: z.array(guestInputSchema).optional(),
});

export async function createWorkout(input: z.infer<typeof createWorkoutSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = createWorkoutSchema.parse(input);
  const id = uuid();
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, parsed.name, parsed.performedOn, parsed.sessionType, null, now, now]
    );
    if (parsed.guests?.length) {
      await insertGuestsInTx(tx, userId, id, parsed.guests);
    }
  });
  return id;
}

// Replace the full guest list for an existing workout (owner only). Same
// delete-then-insert pattern as saveWorkout's set replacement.
const updateSessionGuestsSchema = z.object({
  workoutId: z.string().uuid(),
  guests: z.array(guestInputSchema),
});

export async function updateSessionGuests(
  input: z.infer<typeof updateSessionGuestsSchema>
): Promise<void> {
  const userId = await getCurrentUserId();
  const parsed = updateSessionGuestsSchema.parse(input);

  await powersync.writeTransaction(async (tx) => {
    const owned = await tx.getOptional<{ id: string }>(
      `SELECT id FROM workouts WHERE id = ? AND user_id = ?`,
      [parsed.workoutId, userId]
    );
    if (!owned) throw new Error("Workout not found");

    await tx.execute(
      `DELETE FROM session_guests WHERE workout_id = ? AND user_id = ?`,
      [parsed.workoutId, userId]
    );
    if (parsed.guests.length) {
      await insertGuestsInTx(tx, userId, parsed.workoutId, parsed.guests);
    }
  });
}

const updateWorkoutDetailsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: z.enum(["workout", "stretch", "sport", "lifestyle"]).optional(),
});

export async function updateWorkoutDetails(
  input: z.infer<typeof updateWorkoutDetailsSchema>
): Promise<void> {
  const userId = await getCurrentUserId();
  const parsed = updateWorkoutDetailsSchema.parse(input);
  const now = nowISO();

  // Workout + sets share the denormalised performed_on; keep them in lock-step
  // within a single transaction so a reactive useQuery never sees a mismatch.
  await powersync.writeTransaction(async (tx) => {
    if (parsed.sessionType !== undefined) {
      await tx.execute(
        `UPDATE workouts SET name = ?, performed_on = ?, session_type = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [parsed.name, parsed.performedOn, parsed.sessionType, now, parsed.id, userId]
      );
    } else {
      await tx.execute(
        `UPDATE workouts SET name = ?, performed_on = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [parsed.name, parsed.performedOn, now, parsed.id, userId]
      );
    }
    await tx.execute(
      `UPDATE sets SET performed_on = ? WHERE workout_id = ?`,
      [parsed.performedOn, parsed.id]
    );
  });
}

const copyWorkoutSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: z.enum(["workout", "stretch", "sport", "lifestyle"]).optional().default("workout"),
  guests: z.array(guestInputSchema).optional(),
});

export async function copyWorkout(input: z.infer<typeof copyWorkoutSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = copyWorkoutSchema.parse(input);
  const newId = uuid();
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    const source = await tx.getOptional<{ id: string }>(
      `SELECT id FROM workouts WHERE id = ? AND user_id = ?`,
      [parsed.sourceId, userId]
    );
    if (!source) throw new Error("Workout not found");

    await tx.execute(
      `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, userId, parsed.name, parsed.performedOn, parsed.sessionType, null, now, now]
    );

    const sourceSets = await tx.getAll<{
      exercise_id: string;
      position: number;
      reps: number | null;
      weight_kg: number | null;
      distance_km: number | null;
      duration_sec: number | null;
      resistance: number | null;
      speed_ms: number | null;
      incline_pct: number | null;
      rest_sec: number | null;
      calories: number | null;
      circuit_id: string | null;
      circuit_rounds: number | null;
      circuit_name: string | null;
    }>(`SELECT * FROM sets WHERE workout_id = ? ORDER BY position`, [parsed.sourceId]);

    for (const s of sourceSets) {
      await tx.execute(
        `INSERT INTO sets (
          id, user_id, performed_on, workout_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories,
          circuit_id, circuit_rounds, circuit_name
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?)`,
        [
          uuid(),
          userId,
          parsed.performedOn,
          newId,
          s.exercise_id,
          s.position,
          s.reps,
          s.weight_kg,
          s.distance_km,
          s.duration_sec,
          s.resistance,
          s.speed_ms,
          s.incline_pct,
          s.rest_sec,
          s.calories ?? null,
          s.circuit_id,
          s.circuit_rounds,
          s.circuit_name,
        ]
      );
    }

    if (parsed.guests?.length) {
      await insertGuestsInTx(tx, userId, newId, parsed.guests);
    }
  });

  return newId;
}

// Clones a friend's workout into the signed-in user's library, including the
// title, date, session type, notes, and every set. For exercises that aren't
// already in the user's library (matched case-insensitively by name) we
// delegate to copyExerciseInTx so the missing exercises (and any tag keys
// the user is missing) get backfilled in the same transaction — the whole
// operation is all-or-nothing.
const copyFriendSessionSchema = z.object({ sourceWorkoutId: z.string().uuid() });

export async function copyFriendSession(
  input: z.infer<typeof copyFriendSessionSchema>
): Promise<string> {
  const myUserId = await getCurrentUserId();
  const { sourceWorkoutId } = copyFriendSessionSchema.parse(input);
  const now = nowISO();

  let newWorkoutId = "";

  await powersync.writeTransaction(async (tx) => {
    const sourceWorkoutRow = await tx.getOptional<WorkoutRow>(
      `SELECT * FROM workouts WHERE id = ?`,
      [sourceWorkoutId]
    );
    if (!sourceWorkoutRow) throw new Error("Session not found");
    if (!sourceWorkoutRow.user_id) throw new Error("Session has no owner");
    if (sourceWorkoutRow.user_id === myUserId) {
      throw new Error("That session is already in your library");
    }

    const sourceSets = await tx.getAll<WorkoutSetRow>(
      `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
      [sourceWorkoutId]
    );

    // For each distinct friend exercise, find OR copy the matching exercise
    // in my library. Match on (case-insensitive name, equipment) so a
    // "Push Up" with `bench` equipment doesn't collide with a plain "Push Up"
    // in my library — they're effectively different exercises even though
    // the name matches. Other tracking differences (reps/time/etc.) are
    // tolerated: if the user already has the same name+equipment, we reuse
    // their version. Otherwise we copy a fresh row via copyExerciseInTx.
    const friendExerciseIds = [
      ...new Set(
        sourceSets.map((s) => s.exercise_id).filter((v): v is string => !!v)
      ),
    ];
    const friendToMineExerciseId = new Map<string, string>();
    for (const fid of friendExerciseIds) {
      const friendExRow = await tx.getOptional<ExerciseRow>(
        `SELECT * FROM exercises WHERE id = ?`,
        [fid]
      );
      if (!friendExRow || !friendExRow.name) continue;
      const friendEquipment = friendExRow.equipment ?? null;

      const existingMine = await tx.getOptional<{ id: string }>(
        `SELECT id FROM exercises
         WHERE user_id = ?
           AND LOWER(name) = LOWER(?)
           AND (
             (equipment IS NULL AND ? IS NULL)
             OR equipment = ?
           )
         LIMIT 1`,
        [myUserId, friendExRow.name, friendEquipment, friendEquipment]
      );
      if (existingMine) {
        friendToMineExerciseId.set(fid, existingMine.id);
      } else {
        const copiedId = await copyExerciseInTx(tx, myUserId, fid);
        friendToMineExerciseId.set(fid, copiedId);
      }
    }

    // Insert the workout — keep the friend's title, date, sessionType, notes.
    newWorkoutId = uuid();
    await tx.execute(
      `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newWorkoutId,
        myUserId,
        sourceWorkoutRow.name ?? "Workout",
        sourceWorkoutRow.performed_on ?? "",
        sourceWorkoutRow.session_type ?? "workout",
        sourceWorkoutRow.notes ?? null,
        now,
        now,
      ]
    );

    // Mint fresh circuit ids — friend's circuit_ids belong to friend's
    // workouts and would collide if reused.
    const friendToMineCircuitId = new Map<string, string>();
    for (const s of sourceSets) {
      if (s.circuit_id && !friendToMineCircuitId.has(s.circuit_id)) {
        friendToMineCircuitId.set(s.circuit_id, uuid());
      }
    }

    for (const s of sourceSets) {
      const myExerciseId = friendToMineExerciseId.get(s.exercise_id ?? "");
      // Drop sets pointing at exercises we couldn't resolve (shouldn't happen
      // in practice — followee_exercises sync covers everything friend uses).
      if (!myExerciseId) continue;

      const myCircuitId = s.circuit_id
        ? friendToMineCircuitId.get(s.circuit_id) ?? null
        : null;

      await tx.execute(
        `INSERT INTO sets (
          id, user_id, performed_on, workout_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories,
          circuit_id, circuit_rounds, circuit_name
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?)`,
        [
          uuid(),
          myUserId,
          sourceWorkoutRow.performed_on ?? "",
          newWorkoutId,
          myExerciseId,
          s.position,
          s.reps,
          s.weight_kg,
          s.distance_km,
          s.duration_sec,
          s.resistance,
          s.speed_ms,
          s.incline_pct,
          s.rest_sec,
          s.calories ?? null,
          myCircuitId,
          s.circuit_rounds,
          s.circuit_name,
        ]
      );
    }
  });

  return newWorkoutId;
}

export async function deleteWorkout(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  // Sets cascade-delete via Postgres FK; locally we delete both to keep SQLite consistent.
  await powersync.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM sets WHERE workout_id = ?`, [id]);
    await tx.execute(`DELETE FROM workouts WHERE id = ? AND user_id = ?`, [id, userId]);
  });
}

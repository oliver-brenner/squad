import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { nowISO, uuid } from "@/lib/db/encoding";

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
  circuitId: z.string().uuid().nullable().optional(),
  circuitRounds: z.number().int().min(1).max(999).nullable().optional(),
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
          resistance, speed_ms, incline_pct, rest_sec,
          circuit_id, circuit_rounds, circuit_name
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?)`,
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
          s.circuitId ?? null,
          s.circuitRounds ?? null,
          s.circuitName ?? null,
        ]
      );
    }
  });

  return workoutId;
}

const createWorkoutSchema = z.object({
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: z.enum(["workout", "stretch", "sport", "lifestyle"]).optional().default("workout"),
});

export async function createWorkout(input: z.infer<typeof createWorkoutSchema>): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = createWorkoutSchema.parse(input);
  const id = uuid();
  const now = nowISO();

  await powersync.execute(
    `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, parsed.name, parsed.performedOn, parsed.sessionType, null, now, now]
  );
  return id;
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
      circuit_id: string | null;
      circuit_rounds: number | null;
      circuit_name: string | null;
    }>(`SELECT * FROM sets WHERE workout_id = ? ORDER BY position`, [parsed.sourceId]);

    for (const s of sourceSets) {
      await tx.execute(
        `INSERT INTO sets (
          id, user_id, performed_on, workout_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec,
          circuit_id, circuit_rounds, circuit_name
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?)`,
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
          s.circuit_id,
          s.circuit_rounds,
          s.circuit_name,
        ]
      );
    }
  });

  return newId;
}

export async function deleteWorkout(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  // Sets cascade-delete via Postgres FK; locally we delete both to keep SQLite consistent.
  await powersync.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM sets WHERE workout_id = ?`, [id]);
    await tx.execute(`DELETE FROM workouts WHERE id = ? AND user_id = ?`, [id, userId]);
  });
}

import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { boolInt, nowISO, uuid } from "@/lib/db/encoding";
import type { ExerciseRow, TemplateSetRow, WorkoutRow, WorkoutSetRow } from "@/lib/db/schema";
import { type GuestInput, insertGuestsInTx } from "@/lib/mutations/workouts";
import { copyExerciseInTx } from "@/lib/mutations/exercises";

const sessionTypeSchema = z.enum(["workout", "stretch", "sport", "lifestyle"]);

// A template's skeleton set. Mirrors saveWorkout's setInputSchema minus the
// workout-bound fields (no performedOn) — templates carry no date.
const templateSetInputSchema = z.object({
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
  rpe: z.number().int().min(0).nullable(),
  circuitId: z.string().uuid().nullable().optional(),
  circuitRounds: z.number().int().min(0).max(999).nullable().optional(),
  circuitName: z.string().trim().max(80).nullable().optional(),
  variation: z.string().min(1).max(80).nullable().optional(),
});

async function insertTemplateSetsInTx(
  tx: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  userId: string,
  templateId: string,
  sets: z.infer<typeof templateSetInputSchema>[]
): Promise<void> {
  for (const s of sets) {
    await tx.execute(
      `INSERT INTO template_sets (
        id, template_id, user_id, exercise_id, position,
        reps, weight_kg, distance_km, duration_sec,
        resistance, speed_ms, incline_pct, rest_sec, calories, rpe,
        circuit_id, circuit_rounds, circuit_name, variation
      ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?)`,
      [
        s.id ?? uuid(),
        templateId,
        userId,
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
        s.rpe ?? null,
        s.circuitId ?? null,
        s.circuitRounds ?? null,
        s.circuitName ?? null,
        s.variation ?? null,
      ]
    );
  }
}

// Create an empty template (no sets yet). Used by the "Create Template" entry
// point on the templates list — the editor then upserts content via saveTemplate.
const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sessionType: sessionTypeSchema.optional().default("workout"),
});

export async function createTemplate(
  input: z.infer<typeof createTemplateSchema>
): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = createTemplateSchema.parse(input);
  const id = uuid();
  const now = nowISO();
  await powersync.execute(
    `INSERT INTO templates (id, user_id, name, session_type, notes_public, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, parsed.name, parsed.sessionType, 1, now, now]
  );
  return id;
}

// Save a template and replace its skeleton-set list in one transaction — same
// single-entry-point, delete-then-insert pattern as saveWorkout. Powers both
// the create and the edit-contents flows of the template editor.
const saveTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  sessionType: sessionTypeSchema,
  notes: z.string().trim().max(2000).nullable().optional(),
  notesPublic: z.boolean().optional(),
  sets: z.array(templateSetInputSchema),
});

export async function saveTemplate(
  input: z.infer<typeof saveTemplateSchema>
): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = saveTemplateSchema.parse(input);
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE templates SET name = ?, session_type = ?, notes = ?, notes_public = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        parsed.name,
        parsed.sessionType,
        parsed.notes ?? null,
        boolInt(parsed.notesPublic ?? true),
        now,
        parsed.id,
        userId,
      ]
    );
    await tx.execute(`DELETE FROM template_sets WHERE template_id = ?`, [parsed.id]);
    await insertTemplateSetsInTx(tx, userId, parsed.id, parsed.sets);
  });

  return parsed.id;
}

const renameTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export async function renameTemplate(
  input: z.infer<typeof renameTemplateSchema>
): Promise<void> {
  const userId = await getCurrentUserId();
  const parsed = renameTemplateSchema.parse(input);
  await powersync.execute(
    `UPDATE templates SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [parsed.name, nowISO(), parsed.id, userId]
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  // template_sets cascade-delete via Postgres FK; locally we delete both to
  // keep SQLite consistent.
  await powersync.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM template_sets WHERE template_id = ?`, [id]);
    await tx.execute(`DELETE FROM templates WHERE id = ? AND user_id = ?`, [id, userId]);
  });
}

// Build a template from an existing session: a skeleton of the session's
// exercises with NO set values pre-filled. We keep one empty set per distinct
// (circuit, exercise) so each exercise re-appears when the template is applied,
// preserving exercise order and circuit groupings but dropping reps/weight/etc.
const createTemplateFromWorkoutSchema = z.object({
  workoutId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function createTemplateFromWorkout(
  input: z.infer<typeof createTemplateFromWorkoutSchema>
): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = createTemplateFromWorkoutSchema.parse(input);
  const templateId = uuid();
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    const workout = await tx.getOptional<WorkoutRow>(
      `SELECT * FROM workouts WHERE id = ? AND user_id = ?`,
      [parsed.workoutId, userId]
    );
    if (!workout) throw new Error("Session not found");

    await tx.execute(
      `INSERT INTO templates (id, user_id, name, session_type, notes, notes_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        userId,
        parsed.name?.trim() || workout.name || "Template",
        workout.session_type ?? "workout",
        workout.notes ?? null,
        workout.notes_public ?? 1,
        now,
        now,
      ]
    );

    const sets = await tx.getAll<WorkoutSetRow>(
      `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
      [parsed.workoutId]
    );

    // Keep the first occurrence of each (circuit, exercise) pair — one empty
    // skeleton set apiece, values nulled.
    const seen = new Set<string>();
    let position = 0;
    for (const s of sets) {
      if (!s.exercise_id) continue;
      const key = `${s.circuit_id ?? ""}::${s.exercise_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.execute(
        `INSERT INTO template_sets (
          id, template_id, user_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories, rpe,
          circuit_id, circuit_rounds, circuit_name, variation
        ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?)`,
        [
          uuid(),
          templateId,
          userId,
          s.exercise_id,
          position++,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          s.circuit_id,
          s.circuit_rounds,
          s.circuit_name,
          s.variation,
        ]
      );
    }
  });

  return templateId;
}

// Same as createTemplateFromWorkout, but the source is a FRIEND's session. The
// friend's exercises aren't in my library, so — exactly like copyFriendSession —
// we find-or-copy each into my library (matched case-insensitively by
// name+equipment) and point the skeleton sets at MY exercise ids. The result is
// a normal personal template: an exercise skeleton with no set values.
const createTemplateFromFriendWorkoutSchema = z.object({
  sourceWorkoutId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function createTemplateFromFriendWorkout(
  input: z.infer<typeof createTemplateFromFriendWorkoutSchema>
): Promise<string> {
  const myUserId = await getCurrentUserId();
  const parsed = createTemplateFromFriendWorkoutSchema.parse(input);
  const templateId = uuid();
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    const workout = await tx.getOptional<WorkoutRow>(
      `SELECT * FROM workouts WHERE id = ?`,
      [parsed.sourceWorkoutId]
    );
    if (!workout) throw new Error("Session not found");

    const sourceSets = await tx.getAll<WorkoutSetRow>(
      `SELECT * FROM sets WHERE workout_id = ? ORDER BY position ASC`,
      [parsed.sourceWorkoutId]
    );

    // Resolve each distinct friend exercise to one in my library — reuse the
    // existing one if I have a matching name+equipment, otherwise copy it.
    // Identical strategy to copyFriendSession.
    const friendExerciseIds = [
      ...new Set(sourceSets.map((s) => s.exercise_id).filter((v): v is string => !!v)),
    ];
    const friendToMine = new Map<string, string>();
    for (const fid of friendExerciseIds) {
      const friendEx = await tx.getOptional<ExerciseRow>(
        `SELECT * FROM exercises WHERE id = ?`,
        [fid]
      );
      if (!friendEx || !friendEx.name) continue;
      const equipment = friendEx.equipment ?? null;
      const mine = await tx.getOptional<{ id: string }>(
        `SELECT id FROM exercises
         WHERE user_id = ?
           AND LOWER(name) = LOWER(?)
           AND ((equipment IS NULL AND ? IS NULL) OR equipment = ?)
         LIMIT 1`,
        [myUserId, friendEx.name, equipment, equipment]
      );
      friendToMine.set(fid, mine ? mine.id : await copyExerciseInTx(tx, myUserId, fid));
    }

    await tx.execute(
      `INSERT INTO templates (id, user_id, name, session_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        myUserId,
        parsed.name?.trim() || workout.name || "Template",
        workout.session_type ?? "workout",
        now,
        now,
      ]
    );

    // One empty skeleton set per distinct (circuit, my-exercise) pair — same
    // value-nulling and de-duping as createTemplateFromWorkout.
    const seen = new Set<string>();
    let position = 0;
    for (const s of sourceSets) {
      const myExerciseId = friendToMine.get(s.exercise_id ?? "");
      if (!myExerciseId) continue;
      const key = `${s.circuit_id ?? ""}::${myExerciseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.execute(
        `INSERT INTO template_sets (
          id, template_id, user_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories, rpe,
          circuit_id, circuit_rounds, circuit_name, variation
        ) VALUES (?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?)`,
        [
          uuid(),
          templateId,
          myUserId,
          myExerciseId,
          position++,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          s.circuit_id,
          s.circuit_rounds,
          s.circuit_name,
          s.variation,
        ]
      );
    }
  });

  return templateId;
}

// Materialise a template into a real session. Near-identical to copyWorkout:
// insert a workouts row, copy the template_sets into sets (stamping the chosen
// performed_on and minting fresh circuit ids), and optionally attach guests.
// Name and sessionType come from the new-session screen, which seeds them from
// the template but lets the user override before creating.
const applyTemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: sessionTypeSchema,
  guests: z
    .array(
      z
        .object({
          profileId: z.string().uuid().optional(),
          name: z.string().trim().max(80).optional(),
        })
        .refine((g) => !!g.profileId || !!g.name?.trim(), {
          message: "A guest needs either a profileId or a name",
        })
    )
    .optional(),
});

export async function applyTemplate(
  input: z.infer<typeof applyTemplateSchema>
): Promise<string> {
  const userId = await getCurrentUserId();
  const parsed = applyTemplateSchema.parse(input);
  const workoutId = uuid();
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    const template = await tx.getOptional<{
      id: string;
      notes: string | null;
      notes_public: number | null;
    }>(
      `SELECT id, notes, notes_public FROM templates WHERE id = ? AND user_id = ?`,
      [parsed.templateId, userId]
    );
    if (!template) throw new Error("Template not found");

    await tx.execute(
      `INSERT INTO workouts (id, user_id, name, performed_on, session_type, notes, notes_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workoutId,
        userId,
        parsed.name,
        parsed.performedOn,
        parsed.sessionType,
        template.notes ?? null,
        template.notes_public ?? 1,
        now,
        now,
      ]
    );

    const templateSets = await tx.getAll<TemplateSetRow>(
      `SELECT * FROM template_sets WHERE template_id = ? ORDER BY position ASC`,
      [parsed.templateId]
    );

    // Fresh circuit ids — the template's circuit ids are its own grouping keys
    // and must not be reused on the new session's sets.
    const circuitIdMap = new Map<string, string>();
    for (const s of templateSets) {
      if (s.circuit_id && !circuitIdMap.has(s.circuit_id)) {
        circuitIdMap.set(s.circuit_id, uuid());
      }
    }

    for (const s of templateSets) {
      const circuitId = s.circuit_id ? circuitIdMap.get(s.circuit_id) ?? null : null;
      await tx.execute(
        `INSERT INTO sets (
          id, user_id, performed_on, workout_id, exercise_id, position,
          reps, weight_kg, distance_km, duration_sec,
          resistance, speed_ms, incline_pct, rest_sec, calories, rpe,
          circuit_id, circuit_rounds, circuit_name, variation
        ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?)`,
        [
          uuid(),
          userId,
          parsed.performedOn,
          workoutId,
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
          s.calories,
          s.rpe,
          circuitId,
          s.circuit_rounds,
          s.circuit_name,
          s.variation,
        ]
      );
    }

    if (parsed.guests?.length) {
      await insertGuestsInTx(tx, userId, workoutId, parsed.guests as GuestInput[]);
    }
  });

  return workoutId;
}

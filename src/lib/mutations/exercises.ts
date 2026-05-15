import { z } from "zod";
import { powersync } from "@/lib/db/client";
import { arrStr, boolInt, nowISO, uuid } from "@/lib/db/encoding";
import { supabase } from "@/lib/supabase/client";

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

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function createExercise(input: z.infer<typeof exerciseSchema>): Promise<string> {
  const userId = await currentUserId();
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
  const userId = await currentUserId();
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
  const userId = await currentUserId();
  await powersync.execute(
    `UPDATE exercises SET archived_at = ? WHERE id = ? AND user_id = ?`,
    [nowISO(), id, userId]
  );
}

export async function unarchiveExercise(id: string): Promise<void> {
  const userId = await currentUserId();
  await powersync.execute(
    `UPDATE exercises SET archived_at = NULL WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

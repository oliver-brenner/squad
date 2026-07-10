import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";

// Lowercase letters, digits, underscores, and hyphens. Case-insensitive
// uniqueness is enforced server-side by a unique partial index on
// `lower(username)`; keeping the allowed alphabet to a single case sidesteps
// any "OliverB" vs "oliverb" ambiguity here on the client.
const USERNAME_REGEX = /^[a-z0-9_-]+$/;

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(24, "At most 24 characters")
  .regex(USERNAME_REGEX, "Only lowercase letters, numbers, underscores, and hyphens");

export function validateUsername(input: string): string | null {
  const result = usernameSchema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid username";
}

// Pass `null` or an empty string to clear the username back to its initial
// null state. Any non-empty value is validated against `usernameSchema`.
export async function updateUsername(input: string | null): Promise<void> {
  const userId = await getCurrentUserId();
  const value =
    input === null || input.trim() === "" ? null : usernameSchema.parse(input);
  await powersync.execute(
    `UPDATE profiles SET username = ? WHERE id = ?`,
    [value, userId]
  );
}

export async function updateBodyweightKg(input: number | null): Promise<void> {
  const userId = await getCurrentUserId();
  const value =
    input === null || !Number.isFinite(input) || input <= 0 ? null : input;
  await powersync.execute(
    `UPDATE profiles SET bodyweight_kg = ? WHERE id = ?`,
    [value, userId]
  );
}

export async function updateSex(sex: "male" | "female"): Promise<void> {
  const userId = await getCurrentUserId();
  await powersync.execute(
    `UPDATE profiles SET sex = ? WHERE id = ?`,
    [sex, userId]
  );
}

export async function updateCalorieTrackingEnabled(enabled: boolean): Promise<void> {
  const userId = await getCurrentUserId();
  await powersync.execute(
    `UPDATE profiles SET calorie_tracking_enabled = ? WHERE id = ?`,
    [enabled ? 1 : 0, userId]
  );
}

import { powersync } from "./client";
import { getProfileBodyweightKg } from "./queries";

// Fills `sets.bodyweight_kg` on the user's own legacy sets.
//
// Bodyweight is captured per set now, but sets logged before the column existed
// have NULL — and `setBodyweightKg` reads a NULL as zero, so those sets render
// as reps-only while new ones show the bodyweight. The SQL stats layer already
// treats `profiles.bodyweight_kg` as the value for those rows (see
// SET_BODYWEIGHT_SQL / FEED_SET_BODYWEIGHT_SQL in queries.ts), so writing it in
// makes the stored data agree with what volume totals already assume.
//
// Only sets belonging to the user's own include_bodyweight exercises are
// touched, and only where bodyweight_kg IS NULL — an existing snapshot is never
// overwritten, so a set keeps the weight it was actually logged at. That makes
// this idempotent and safe to run on every boot rather than behind a one-shot
// flag: rows that stream down from sync later get picked up on the next launch
// instead of being missed forever.
//
// No-ops when the profile has no bodyweight, since there'd be nothing to write.
// Returns the number of rows filled (0 when there was nothing to do).
export async function backfillLegacySetBodyweight(userId: string): Promise<number> {
  const bodyweightKg = await getProfileBodyweightKg(userId);
  if (bodyweightKg <= 0) return 0;

  const pending = await powersync.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sets
     WHERE user_id = ? AND bodyweight_kg IS NULL
       AND exercise_id IN (
         SELECT id FROM exercises WHERE user_id = ? AND include_bodyweight = 1
       )`,
    [userId, userId]
  );
  if (pending.count === 0) return 0;

  await powersync.execute(
    `UPDATE sets SET bodyweight_kg = ?
     WHERE user_id = ? AND bodyweight_kg IS NULL
       AND exercise_id IN (
         SELECT id FROM exercises WHERE user_id = ? AND include_bodyweight = 1
       )`,
    [bodyweightKg, userId, userId]
  );
  return pending.count;
}

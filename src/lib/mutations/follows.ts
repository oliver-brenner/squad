import { z } from "zod";
import { powersync } from "@/lib/db/client";
import { nowISO, uuid } from "@/lib/db/encoding";
import { supabase } from "@/lib/supabase/client";

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

const followeeIdSchema = z.string().uuid();

export async function followUser(followeeId: string): Promise<void> {
  const userId = await currentUserId();
  const id = followeeIdSchema.parse(followeeId);
  if (id === userId) throw new Error("Cannot follow yourself");

  // Idempotent — Postgres-side unique constraint on (follower_id, followee_id)
  // is the real defence; this avoids the local insert + sync churn.
  const existing = await powersync.getOptional<{ id: string }>(
    `SELECT id FROM follows WHERE follower_id = ? AND followee_id = ?`,
    [userId, id]
  );
  if (existing) return;

  await powersync.execute(
    `INSERT INTO follows (id, follower_id, followee_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [uuid(), userId, id, nowISO()]
  );
}

export async function unfollowUser(followeeId: string): Promise<void> {
  const userId = await currentUserId();
  const id = followeeIdSchema.parse(followeeId);
  await powersync.execute(
    `DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`,
    [userId, id]
  );
}

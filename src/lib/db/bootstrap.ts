import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { powersync } from "./client";
import { nowISO, uuid } from "./encoding";
import {
  CATEGORIES,
  EQUIPMENT_OPTIONS,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  type Category,
  type Equipment,
} from "@/lib/exercise-options";

// Resolves true if the promise settled in time, false if it timed out. The
// underlying promise is left running — nothing here needs to cancel it.
async function withTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const titleCase = (s: string) =>
  s
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// Runs once per user, on first sign-in. Waits for the initial PowerSync pull
// so we don't double-seed on a returning user whose data already exists in
// Postgres but hasn't yet streamed down to this device.
// Seeds: profile row + default field options (categories, equipment, muscle
// groups). New users start with no exercises — they build their library themselves.
export async function bootstrapIfNeeded(user: User): Promise<void> {
  // Waiting for the first sync is how we avoid double-seeding a returning user
  // whose rows exist in Postgres but haven't streamed down yet. It can't be an
  // unbounded wait though: on a device whose sync is stalled it never resolves,
  // and a new user would then never get their default field options. Time out
  // and fall back to asking Postgres directly.
  const synced = await withTimeout(powersync.waitForFirstSync(), 15_000);

  const existingLocal = await powersync.getOptional<{ id: string }>(
    "SELECT id FROM profiles WHERE id = ?",
    [user.id]
  );
  if (existingLocal) return;

  if (!synced) {
    // First sync didn't finish, so "no local profile row" proves nothing. Ask
    // the server before seeding — a false negative here would INSERT a second
    // profile row, and the connector's upsert would then overwrite the real one
    // (blanking their username) on the way up.
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // Can't prove the user is new — do nothing rather than risk clobbering an
      // existing profile. A later launch retries this.
      console.warn("[powersync] bootstrap skipped: profile lookup failed:", error);
      return;
    }
    if (data) return;
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split("@")[0] ??
    null;
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;
  const now = nowISO();

  await powersync.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO profiles (id, username, display_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, null, displayName, avatarUrl, now]
    );

    const optionSql = `INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    for (let i = 0; i < CATEGORIES.length; i++) {
      const c: Category = CATEGORIES[i];
      await tx.execute(optionSql, [uuid(), user.id, "category", null, c, titleCase(c), i, now]);
    }

    for (let i = 0; i < EQUIPMENT_OPTIONS.length; i++) {
      const e: Equipment = EQUIPMENT_OPTIONS[i];
      await tx.execute(optionSql, [
        uuid(),
        user.id,
        "equipment",
        null,
        e,
        EQUIPMENT_LABELS[e] ?? titleCase(e),
        i,
        now,
      ]);
    }

    for (let gi = 0; gi < MUSCLE_GROUPS.length; gi++) {
      const g = MUSCLE_GROUPS[gi];
      const groupId = uuid();
      await tx.execute(optionSql, [groupId, user.id, "muscle_group", null, g.id, g.label, gi, now]);
      for (let ci = 0; ci < g.children.length; ci++) {
        const c = g.children[ci];
        await tx.execute(optionSql, [uuid(), user.id, "muscle_child", groupId, c.id, c.label, ci, now]);
      }
    }
  });
}

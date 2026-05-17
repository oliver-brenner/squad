import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { powersync } from "@/lib/db/client";
import { arr, arrStr, nowISO, uuid } from "@/lib/db/encoding";
import type { UserFieldKind } from "@/lib/db/schema";
import type { Transaction } from "@powersync/web";

const KIND_VALUES = ["category", "equipment", "muscle_group", "muscle_child"] as const;

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function ensureUniqueKey(
  userId: string,
  kind: UserFieldKind,
  base: string,
  parentId?: string | null
): Promise<string> {
  // For muscle_child, uniqueness is per-parent — the same key under a different parent is fine.
  const rows =
    kind === "muscle_child" && parentId
      ? await powersync.getAll<{ key: string }>(
          `SELECT key FROM user_field_options WHERE user_id = ? AND kind = ? AND parent_id = ?`,
          [userId, kind, parentId]
        )
      : await powersync.getAll<{ key: string }>(
          `SELECT key FROM user_field_options WHERE user_id = ? AND kind = ?`,
          [userId, kind]
        );
  const used = new Set(rows.map((r) => r.key));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

const addSchema = z.object({
  kind: z.enum(KIND_VALUES),
  label: z.string().trim().min(1).max(80),
  parentId: z.string().uuid().nullable().optional(),
});

export async function addFieldOption(input: z.infer<typeof addSchema>): Promise<void> {
  const userId = await getCurrentUserId();
  const data = addSchema.parse(input);

  if (data.kind === "muscle_child" && !data.parentId) {
    throw new Error("muscle_child requires parentId");
  }
  if (data.kind !== "muscle_child" && data.parentId) {
    throw new Error("parentId only allowed for muscle_child");
  }

  const baseKey = slugify(data.label);
  if (!baseKey) throw new Error("Label must contain at least one alphanumeric character");
  const key = await ensureUniqueKey(userId, data.kind, baseKey, data.parentId);

  const positionRows = await powersync.getAll<{ position: number }>(
    `SELECT position FROM user_field_options WHERE user_id = ? AND kind = ?`,
    [userId, data.kind]
  );
  const nextPosition =
    positionRows.length === 0 ? 0 : Math.max(...positionRows.map((r) => r.position)) + 1;

  await powersync.execute(
    `INSERT INTO user_field_options (id, user_id, kind, parent_id, key, label, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, data.kind, data.parentId ?? null, key, data.label.trim(), nextPosition, nowISO()]
  );
}

const renameSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
});

export async function renameFieldOption(input: z.infer<typeof renameSchema>): Promise<void> {
  const userId = await getCurrentUserId();
  const data = renameSchema.parse(input);
  await powersync.execute(
    `UPDATE user_field_options SET label = ? WHERE id = ? AND user_id = ?`,
    [data.label.trim(), data.id, userId]
  );
}

const reorderSchema = z.object({
  kind: z.enum(KIND_VALUES),
  parentId: z.string().uuid().nullable().optional(),
  ids: z.array(z.string().uuid()).min(1),
});

export async function reorderFieldOptions(input: z.infer<typeof reorderSchema>): Promise<void> {
  const userId = await getCurrentUserId();
  const data = reorderSchema.parse(input);

  await powersync.writeTransaction(async (tx) => {
    for (let i = 0; i < data.ids.length; i++) {
      await tx.execute(
        `UPDATE user_field_options SET position = ?
         WHERE id = ? AND user_id = ? AND kind = ?`,
        [i, data.ids[i], userId, data.kind]
      );
    }
  });
}

// SQLite has no array_remove() — pull rows, filter the JSON array in JS, write back.
async function unassignKeyFromExercises(
  tx: Transaction,
  userId: string,
  kind: UserFieldKind,
  key: string
): Promise<void> {
  if (kind === "category") {
    const rows = await tx.getAll<{ id: string; categories: string | null }>(
      `SELECT id, categories FROM exercises WHERE user_id = ?`,
      [userId]
    );
    for (const r of rows) {
      const list = arr(r.categories);
      if (!list || !list.includes(key)) continue;
      const next = list.filter((k) => k !== key);
      await tx.execute(
        `UPDATE exercises SET categories = ? WHERE id = ?`,
        [arrStr(next.length > 0 ? next : null), r.id]
      );
    }
  } else if (kind === "equipment") {
    await tx.execute(
      `UPDATE exercises SET equipment = NULL WHERE user_id = ? AND equipment = ?`,
      [userId, key]
    );
  } else if (kind === "muscle_group" || kind === "muscle_child") {
    const rows = await tx.getAll<{ id: string; muscles: string | null }>(
      `SELECT id, muscles FROM exercises WHERE user_id = ?`,
      [userId]
    );
    for (const r of rows) {
      const list = arr(r.muscles);
      if (!list || !list.includes(key)) continue;
      const next = list.filter((k) => k !== key);
      await tx.execute(
        `UPDATE exercises SET muscles = ? WHERE id = ?`,
        [arrStr(next.length > 0 ? next : null), r.id]
      );
    }
  }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteFieldOption(input: z.infer<typeof deleteSchema>): Promise<void> {
  const userId = await getCurrentUserId();
  const { id } = deleteSchema.parse(input);

  const target = await powersync.getOptional<{
    id: string;
    kind: UserFieldKind;
    key: string;
  }>(
    `SELECT id, kind, key FROM user_field_options WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  if (!target) return;

  await powersync.writeTransaction(async (tx) => {
    if (target.kind === "muscle_group") {
      const children = await tx.getAll<{ id: string; key: string }>(
        `SELECT id, key FROM user_field_options
         WHERE user_id = ? AND kind = 'muscle_child' AND parent_id = ?`,
        [userId, target.id]
      );
      await tx.execute(
        `DELETE FROM user_field_options WHERE user_id = ? AND parent_id = ?`,
        [userId, target.id]
      );
      for (const c of children) {
        const otherRef = await tx.getOptional<{ id: string }>(
          `SELECT id FROM user_field_options
           WHERE user_id = ? AND kind = 'muscle_child' AND key = ? LIMIT 1`,
          [userId, c.key]
        );
        if (!otherRef) {
          await unassignKeyFromExercises(tx, userId, "muscle_child", c.key);
        }
      }
    } else if (target.kind === "muscle_child") {
      await tx.execute(
        `DELETE FROM user_field_options WHERE id = ? AND user_id = ?`,
        [id, userId]
      );
      const otherRef = await tx.getOptional<{ id: string }>(
        `SELECT id FROM user_field_options
         WHERE user_id = ? AND kind = 'muscle_child' AND key = ? LIMIT 1`,
        [userId, target.key]
      );
      if (!otherRef) {
        await unassignKeyFromExercises(tx, userId, "muscle_child", target.key);
      }
      return;
    }
    await unassignKeyFromExercises(tx, userId, target.kind, target.key);
    await tx.execute(
      `DELETE FROM user_field_options WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
  });
}

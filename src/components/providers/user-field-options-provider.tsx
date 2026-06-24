import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeUserFieldOption } from "@/lib/db/decoders";
import type { UserFieldOptionRow } from "@/lib/db/schema";
import type { UserFieldOptions, MuscleGroupNode } from "@/lib/user-field-options";

// Holds the field options of every user we've synced locally:
//   - the signed-in user (always present once bootstrap finishes)
//   - every followee (synced via the `followee_field_options` bucket)
//
// Friends-feed UIs (`ExerciseMetaTags`) need a followee's *own* labels to
// render their tags correctly — categories/equipment/muscle keys overlap
// for the defaults but a friend can rename or add their own.

type Ctx = {
  // The current user's options. Same shape as the original hook so existing
  // callers (editors, library, settings) don't need to change.
  current: UserFieldOptions;
  // Lookup by any synced user. Returns `current` as fallback when the
  // requested user isn't synced yet or matches the signed-in user.
  forUser: (userId: string | null | undefined) => UserFieldOptions;
};

const FieldOptionsCtx = createContext<Ctx | null>(null);

const EMPTY: UserFieldOptions = {
  categories: [],
  equipment: [],
  muscleGroups: [],
};

// Reactive: re-renders whenever any synced user_field_options row changes
// (own edits, remote updates streaming down from another device, or a new
// followee's options arriving). Mounts inside PowerSyncProvider, so the
// database is guaranteed to exist when this runs.
export function UserFieldOptionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";

  // No user_id filter here — we want every synced row (own + followees).
  // The local SQLite never contains strangers' rows (sync rules enforce
  // that), so this is bounded by "you + people you follow".
  const { data: rawRows } = useQuery<UserFieldOptionRow>(
    `SELECT * FROM user_field_options`
  );

  const value = useMemo<Ctx>(() => {
    const rows = (rawRows ?? []).map(decodeUserFieldOption);

    // Bucket rows by their owner first, then build the structured view once
    // per user.
    const rowsByUser = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = rowsByUser.get(r.userId) ?? [];
      arr.push(r);
      rowsByUser.set(r.userId, arr);
    }

    const builtByUser = new Map<string, UserFieldOptions>();
    for (const [uid, userRows] of rowsByUser) {
      builtByUser.set(uid, buildUserFieldOptions(userRows));
    }

    const current = builtByUser.get(currentUserId) ?? EMPTY;
    const forUser = (userId: string | null | undefined): UserFieldOptions => {
      if (!userId || userId === currentUserId) return current;
      return builtByUser.get(userId) ?? current;
    };

    return { current, forUser };
  }, [rawRows, currentUserId]);

  return <FieldOptionsCtx.Provider value={value}>{children}</FieldOptionsCtx.Provider>;
}

// Existing hook — current user's options. Unchanged callers keep working.
export function useUserFieldOptions(): UserFieldOptions {
  const v = useContext(FieldOptionsCtx);
  if (!v) {
    throw new Error("useUserFieldOptions must be used inside UserFieldOptionsProvider");
  }
  return v.current;
}

// New hook — resolve another user's options. Pass `null`/`undefined` to fall
// back to the current user's (handy when the owner is unknown at the call site).
export function useUserFieldOptionsForUser(userId: string | null | undefined): UserFieldOptions {
  const v = useContext(FieldOptionsCtx);
  if (!v) {
    throw new Error(
      "useUserFieldOptionsForUser must be used inside UserFieldOptionsProvider"
    );
  }
  return v.forUser(userId);
}

function buildUserFieldOptions(
  rows: ReturnType<typeof decodeUserFieldOption>[]
): UserFieldOptions {
  const toOption = (r: { id: string; key: string; label: string; position: number }) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    position: r.position,
  });

  const categories = rows
    .filter((r) => r.kind === "category")
    .sort((a, b) => a.position - b.position)
    .map(toOption);

  const equipment = rows
    .filter((r) => r.kind === "equipment")
    .sort((a, b) => a.position - b.position)
    .map(toOption);

  const groupRows = rows
    .filter((r) => r.kind === "muscle_group")
    .sort((a, b) => a.position - b.position);

  const childrenByParent = new Map<string, ReturnType<typeof toOption>[]>();
  for (const child of rows.filter((r) => r.kind === "muscle_child")) {
    if (!child.parentId) continue;
    const arr = childrenByParent.get(child.parentId) ?? [];
    arr.push(toOption(child));
    childrenByParent.set(child.parentId, arr);
  }
  const muscleGroups: MuscleGroupNode[] = groupRows.map((g) => ({
    ...toOption(g),
    children: (childrenByParent.get(g.id) ?? []).sort((a, b) => a.position - b.position),
  }));

  return { categories, equipment, muscleGroups };
}

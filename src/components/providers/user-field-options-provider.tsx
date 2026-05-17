import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeUserFieldOption } from "@/lib/db/decoders";
import type { UserFieldOptionRow } from "@/lib/db/schema";
import type { UserFieldOptions, MuscleGroupNode } from "@/lib/user-field-options";

const Ctx = createContext<UserFieldOptions | null>(null);

// Reactive: re-renders whenever user_field_options rows change (own edits or
// remote updates streaming down from another device). The provider mounts inside
// PowerSyncProvider, so the database is guaranteed to exist when this runs.
export function UserFieldOptionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data: rawRows } = useQuery<UserFieldOptionRow>(
    `SELECT * FROM user_field_options WHERE user_id = ?`,
    [userId]
  );

  const value = useMemo<UserFieldOptions>(() => {
    const rows = (rawRows ?? []).map(decodeUserFieldOption);

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
  }, [rawRows]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserFieldOptions(): UserFieldOptions {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useUserFieldOptions must be used inside UserFieldOptionsProvider");
  }
  return v;
}

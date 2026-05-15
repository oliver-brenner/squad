import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import type { Exercise } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import { expandMuscleFilter } from "@/lib/user-field-options";

interface Props {
  exercises: Exercise[];
  renderExercise: (exercise: Exercise) => React.ReactNode;
  searchPlaceholder?: string;
}

export function ExerciseFilteredList({
  exercises,
  renderExercise,
  searchPlaceholder = "Search exercises…",
}: Props) {
  const { categories, equipment: equipmentOptions, muscleGroups } = useUserFieldOptions();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [equipmentFilter, setEquipmentFilter] = useState<Set<string>>(new Set());
  const [muscleFilter, setMuscleFilter] = useState<Set<string>>(new Set());
  const [expandedMuscleGroups, setExpandedMuscleGroups] = useState<Set<string>>(new Set());
  const [openFilters, setOpenFilters] = useState<Set<string>>(new Set());

  function toggleFilterPanel(key: string) {
    setOpenFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        if (key === "category") setCategoryFilter(new Set());
        if (key === "equipment") setEquipmentFilter(new Set());
        if (key === "muscle") {
          setMuscleFilter(new Set());
          setExpandedMuscleGroups(new Set());
        }
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const expanded =
      muscleFilter.size > 0 ? expandMuscleFilter(muscleFilter, muscleGroups) : null;
    return exercises
      .filter((e) => !e.archivedAt)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .filter(
        (e) =>
          categoryFilter.size === 0 || e.categories?.some((c) => categoryFilter.has(c))
      )
      .filter(
        (e) =>
          equipmentFilter.size === 0 ||
          (e.equipment != null && equipmentFilter.has(e.equipment))
      )
      .filter(
        (e) =>
          !expanded ||
          (e.muscles?.some((m) => expanded.has(m)) ?? false) ||
          (e.secondaryMuscles?.some((m) => expanded.has(m)) ?? false)
      );
  }, [query, exercises, categoryFilter, equipmentFilter, muscleFilter, muscleGroups]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "category", label: "Category", active: categoryFilter.size > 0 },
              { key: "equipment", label: "Equipment", active: equipmentFilter.size > 0 },
              { key: "muscle", label: "Muscle", active: muscleFilter.size > 0 },
            ].map(({ key, label, active }) => {
              const on = openFilters.has(key) || active;
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleFilterPanel(key)}
                  className={
                    on
                      ? "bg-blue-500 border-blue-500 text-white hover:bg-blue-600 hover:text-white hover:border-blue-600"
                      : ""
                  }
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>

        {openFilters.has("category") && (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Button
                key={c.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setCategoryFilter((prev) => {
                    const next = new Set(prev);
                    next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                    return next;
                  })
                }
                className={
                  categoryFilter.has(c.key)
                    ? "bg-white border-white text-black hover:bg-zinc-100 hover:text-black hover:border-zinc-100"
                    : ""
                }
              >
                {c.label}
              </Button>
            ))}
          </div>
        )}

        {openFilters.has("equipment") && (
          <div className="flex flex-wrap gap-2">
            {equipmentOptions.map((eq) => (
              <Button
                key={eq.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setEquipmentFilter((prev) => {
                    const next = new Set(prev);
                    next.has(eq.key) ? next.delete(eq.key) : next.add(eq.key);
                    return next;
                  })
                }
                className={
                  equipmentFilter.has(eq.key)
                    ? "bg-white border-white text-black hover:bg-zinc-100 hover:text-black hover:border-zinc-100"
                    : "bg-zinc-900 border-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-zinc-100"
                }
              >
                {eq.label}
              </Button>
            ))}
          </div>
        )}

        {openFilters.has("muscle") && (
          <>
            <div className="flex flex-wrap gap-2">
              {muscleGroups.map((g) => {
                const active =
                  muscleFilter.has(g.key) ||
                  (expandedMuscleGroups.has(g.key) &&
                    g.children.some((c) => muscleFilter.has(c.key)));
                return (
                  <Button
                    key={g.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const isExpanded = expandedMuscleGroups.has(g.key);
                      setExpandedMuscleGroups((prev) => {
                        const next = new Set(prev);
                        isExpanded ? next.delete(g.key) : next.add(g.key);
                        return next;
                      });
                      setMuscleFilter((prev) => {
                        const next = new Set(prev);
                        if (isExpanded) {
                          next.delete(g.key);
                          for (const child of g.children) next.delete(child.key);
                        } else {
                          next.add(g.key);
                        }
                        return next;
                      });
                    }}
                    className={
                      active
                        ? "bg-white border-white text-black hover:bg-zinc-100 hover:text-black hover:border-zinc-100"
                        : "bg-zinc-800 border-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-zinc-100"
                    }
                  >
                    {g.label}
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {muscleGroups
                .filter((g) => expandedMuscleGroups.has(g.key))
                .flatMap((g) => g.children)
                .filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i)
                .map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMuscleFilter((prev) => {
                        const next = new Set(prev);
                        const parents = muscleGroups.filter((g) =>
                          g.children.some((ch) => ch.key === c.key)
                        );
                        if (next.has(c.key)) {
                          next.delete(c.key);
                          for (const parent of parents) {
                            if (expandedMuscleGroups.has(parent.key)) {
                              const otherChildSelected = parent.children.some(
                                (ch) => ch.key !== c.key && next.has(ch.key)
                              );
                              if (!otherChildSelected) next.add(parent.key);
                            }
                          }
                        } else {
                          next.add(c.key);
                          for (const parent of parents) next.delete(parent.key);
                        }
                        return next;
                      })
                    }
                    className={
                      muscleFilter.has(c.key)
                        ? "bg-white border-white text-black hover:bg-zinc-100 hover:text-black hover:border-zinc-100"
                        : "bg-zinc-700 border-zinc-700 text-zinc-100 hover:bg-zinc-600 hover:text-zinc-100"
                    }
                  >
                    {c.label}
                  </Button>
                ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
        />
      </div>

      <div className="flex flex-col gap-2">
        {filtered.map((exercise) => renderExercise(exercise))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No exercises match.
          </p>
        )}
      </div>
    </>
  );
}

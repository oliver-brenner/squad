import React from "react";
import { useUserFieldOptionsForUser } from "@/components/providers/user-field-options-provider";
import { buildMuscleLabelMap, flattenMuscleKeys } from "@/lib/user-field-options";

export function BarbellIcon({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 20 10"
      fill="currentColor"
      aria-hidden="true"
      className={className ?? "inline-block shrink-0 w-3 h-3"}
    >
      <rect x="0" y="4" width="20" height="2" rx="0.5" />
      <rect x="2" y="0" width="2.5" height="10" rx="0.75" />
      <rect x="15.5" y="0" width="2.5" height="10" rx="0.75" />
    </svg>
  );
}

export function Dot() {
  return (
    <svg
      viewBox="0 0 6 6"
      width="5"
      height="5"
      fill="currentColor"
      aria-hidden="true"
      className="inline-block shrink-0 opacity-40"
    >
      <circle cx="3" cy="3" r="2" />
    </svg>
  );
}

type ExerciseMeta = {
  // Owner of the exercise — used to resolve category/equipment/muscle keys
  // against THEIR field options, so a friend's tags render with their own
  // custom labels rather than the viewer's. Optional for backwards-compat
  // with call sites that haven't been threaded yet; falls back to the
  // current user's options.
  userId?: string | null;
  categories?: string[] | null;
  equipment?: string | null;
  muscles?: string[] | null;
  secondaryMuscles?: string[] | null;
  isBodyweight: boolean;
  defaultWeightKg: number;
  doubleReps: boolean;
};

// Whether ExerciseMetaTags would render anything for this exercise. Used to
// decide if a trailing item (e.g. the selected-variation tag) needs a leading
// Dot separator, matching how the tags themselves are delimited.
export function exerciseHasMetaTags(e: {
  categories?: string[] | null;
  equipment?: string | null;
  muscles?: string[] | null;
  secondaryMuscles?: string[] | null;
  defaultWeightKg: number;
  doubleReps: boolean;
}): boolean {
  return (
    (e.categories?.length ?? 0) > 0 ||
    !!e.equipment ||
    (e.muscles?.length ?? 0) > 0 ||
    (e.secondaryMuscles?.length ?? 0) > 0 ||
    e.defaultWeightKg > 0 ||
    e.doubleReps
  );
}

export function ExerciseMetaTags({ e }: { e: ExerciseMeta }) {
  const { categories, equipment: equipmentOptions, muscleGroups } =
    useUserFieldOptionsForUser(e.userId);
  const muscleLabels = buildMuscleLabelMap(muscleGroups);
  const orderedMuscleKeys = flattenMuscleKeys(muscleGroups);
  const primaryMuscles = e.muscles ?? [];
  const secondaryMuscles = e.secondaryMuscles ?? [];
  const allSelectedMuscles = [...primaryMuscles, ...secondaryMuscles];
  const muscleSet = new Set(allSelectedMuscles);
  const groupKeys = new Set(muscleGroups.map((g) => g.key));

  function filterParents(muscles: string[], fullSet: Set<string>) {
    return muscles.filter((m) => {
      if (!groupKeys.has(m)) return true;
      const group = muscleGroups.find((g) => g.key === m);
      return !group || !group.children.some((c) => fullSet.has(c.key));
    });
  }

  const sortedPrimary = filterParents([...new Set(primaryMuscles)], muscleSet).sort(
    (a, b) => orderedMuscleKeys.indexOf(a) - orderedMuscleKeys.indexOf(b)
  );
  const sortedSecondary = filterParents([...new Set(secondaryMuscles)], muscleSet)
    .filter((m) => !sortedPrimary.includes(m))
    .sort((a, b) => orderedMuscleKeys.indexOf(a) - orderedMuscleKeys.indexOf(b));

  const categoryLabels = [...new Set(e.categories ?? [])].map((k) =>
    (categories.find((c) => c.key === k)?.label ?? k).toLowerCase()
  );
  const equipmentLabel = e.equipment
    ? (equipmentOptions.find((eq) => eq.key === e.equipment)?.label ?? e.equipment).toLowerCase()
    : null;

  const headerParts: React.ReactNode[] =
    categoryLabels.length > 0 ? [categoryLabels.join(", ")] : [];
  if (equipmentLabel) headerParts.push(equipmentLabel);

  return (
    <>
      {headerParts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="inline-flex items-center mx-1">
              <Dot />
            </span>
          )}
          <span className="whitespace-nowrap">{p}</span>
        </React.Fragment>
      ))}
      {(sortedPrimary.length > 0 || sortedSecondary.length > 0) && headerParts.length > 0 && (
        <span className="inline-flex items-center mx-1">
          <Dot />
        </span>
      )}
      {sortedPrimary.map((m, i) => (
        <span key={m} className="whitespace-nowrap">
          {(muscleLabels.get(m) ?? m).toLowerCase()}
          {i < sortedPrimary.length - 1 ? ", " : ""}
        </span>
      ))}
      {sortedPrimary.length > 0 && sortedSecondary.length > 0 && (
        <span className="inline-flex items-center mx-1">
          <Dot />
        </span>
      )}
      {sortedSecondary.map((m, i) => (
        <span key={m} className="whitespace-nowrap">
          {(muscleLabels.get(m) ?? m).toLowerCase()}
          {i < sortedSecondary.length - 1 ? ", " : ""}
        </span>
      ))}
      {e.defaultWeightKg > 0 && (
        <>
          <span className="inline-flex items-center mx-1">
            <Dot />
          </span>
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
            <BarbellIcon />
            {e.defaultWeightKg}kg
          </span>
        </>
      )}
      {e.doubleReps && (
        <>
          <span className="inline-flex items-center mx-1">
            <Dot />
          </span>
          <span className="whitespace-nowrap">x2</span>
        </>
      )}
    </>
  );
}

import React from "react";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
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

function Dot() {
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
  categories?: string[] | null;
  equipment?: string | null;
  muscles?: string[] | null;
  secondaryMuscles?: string[] | null;
  isBodyweight: boolean;
  defaultWeightKg: number;
  doubleReps: boolean;
};

export function ExerciseMetaTags({ e }: { e: ExerciseMeta }) {
  const { categories, equipment: equipmentOptions, muscleGroups } = useUserFieldOptions();
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
  const sortedMuscles = [...sortedPrimary, ...sortedSecondary];

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
      {sortedMuscles.length > 0 && headerParts.length > 0 && (
        <span className="inline-flex items-center mx-1">
          <Dot />
        </span>
      )}
      {sortedMuscles.map((m, i) => (
        <span key={m} className="whitespace-nowrap">
          {(muscleLabels.get(m) ?? m).toLowerCase()}
          {i < sortedMuscles.length - 1 ? ", " : ""}
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

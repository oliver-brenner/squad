export type FieldOption = {
  id: string;
  key: string;
  label: string;
  position: number;
};

export type MuscleGroupNode = FieldOption & {
  children: FieldOption[];
};

export type UserFieldOptions = {
  categories: FieldOption[];
  equipment: FieldOption[];
  muscleGroups: MuscleGroupNode[];
  variations: FieldOption[];
};

export function expandMuscleFilter(
  filter: Set<string>,
  muscleGroups: MuscleGroupNode[]
): Set<string> {
  const expanded = new Set<string>();
  for (const key of filter) {
    expanded.add(key);
    const group = muscleGroups.find((g) => g.key === key);
    if (group) for (const child of group.children) expanded.add(child.key);
  }
  return expanded;
}

export function buildMuscleLabelMap(muscleGroups: MuscleGroupNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of muscleGroups) {
    map.set(g.key, g.label);
    for (const c of g.children) map.set(c.key, c.label);
  }
  return map;
}

export function flattenMuscleKeys(muscleGroups: MuscleGroupNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of muscleGroups) {
    if (!seen.has(g.key)) {
      seen.add(g.key);
      out.push(g.key);
    }
    for (const c of g.children) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        out.push(c.key);
      }
    }
  }
  return out;
}

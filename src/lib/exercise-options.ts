export type Category = "resistance" | "functional" | "conditioning" | "cardio" | "mobility";

export const CATEGORIES: Category[] = ["resistance", "functional", "conditioning", "cardio", "mobility"];

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "cable"
  | "kettlebell"
  | "machine"
  | "sled"
  | "medicine ball"
  | "ez bar"
  | "t-bar"
  | "smith machine"
  | "bodyweight";
export const EQUIPMENT_OPTIONS: Equipment[] = [
  "barbell",
  "dumbbell",
  "cable",
  "kettlebell",
  "machine",
  "sled",
  "medicine ball",
  "ez bar",
  "t-bar",
  "smith machine",
  "bodyweight",
];

export const EQUIPMENT_LABELS: Partial<Record<Equipment, string>> = {
  "ez bar": "EZ bar",
};

export const MUSCLE_GROUPS = [
  {
    id: "chest",
    label: "Chest",
    children: [
      { id: "upper chest", label: "Upper Chest" },
      { id: "lower chest", label: "Lower Chest" },
    ],
  },
  {
    id: "back",
    label: "Back",
    children: [
      { id: "lats", label: "Lats" },
      { id: "upper back", label: "Upper Back" },
      { id: "lower back", label: "Lower Back" },
      { id: "traps", label: "Traps" },
    ],
  },
  {
    id: "shoulders",
    label: "Shoulders",
    children: [
      { id: "front delts", label: "Front Delts" },
      { id: "side delts", label: "Side Delts" },
      { id: "rear delts", label: "Rear Delts" },
    ],
  },
  {
    id: "arms",
    label: "Arms",
    children: [
      { id: "biceps", label: "Biceps" },
      { id: "triceps", label: "Triceps" },
      { id: "forearms", label: "Forearms" },
    ],
  },
  {
    id: "core",
    label: "Core",
    children: [
      { id: "abs", label: "Abs" },
      { id: "obliques", label: "Obliques" },
    ],
  },
  {
    id: "legs",
    label: "Legs",
    children: [
      { id: "quads", label: "Quads" },
      { id: "hamstrings", label: "Hamstrings" },
      { id: "glutes", label: "Glutes" },
      { id: "calves", label: "Calves" },
      { id: "hip flexors", label: "Hip Flexors" },
      { id: "groin", label: "Groin" },
      { id: "ankles", label: "Ankles" },
    ],
  },
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]["id"];
export type MuscleChild = (typeof MUSCLE_GROUPS)[number]["children"][number]["id"];
export type Muscle = MuscleGroup | MuscleChild;

export const MUSCLE_OPTIONS: Muscle[] = MUSCLE_GROUPS.flatMap((g) => [
  g.id as Muscle,
  ...g.children.map((c) => c.id as Muscle),
]);

export const MUSCLE_CHILDREN: { id: MuscleChild; label: string }[] = MUSCLE_GROUPS.flatMap((g) =>
  g.children.map((c) => ({ id: c.id as MuscleChild, label: c.label }))
);

export const MUSCLE_LABELS: Partial<Record<Muscle, string>> = Object.fromEntries(
  MUSCLE_GROUPS.flatMap((g) => [[g.id, g.label], ...g.children.map((c) => [c.id, c.label])])
) as Partial<Record<Muscle, string>>;

export function expandMuscleFilter(filter: Set<Muscle>): Set<string> {
  const expanded = new Set<string>();
  for (const id of filter) {
    expanded.add(id);
    const group = MUSCLE_GROUPS.find((g) => g.id === id);
    if (group) group.children.forEach((c) => expanded.add(c.id));
  }
  return expanded;
}

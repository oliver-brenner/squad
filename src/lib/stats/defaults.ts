export const DEFAULT_EXERCISES: Array<{
  name: string;
  category: "resistance" | "cardio" | "functional" | "mobility" | "conditioning";
  equipment?: "barbell" | "dumbbell" | "cable" | "kettlebell" | "machine";
  isBodyweight?: boolean;
  defaultWeightKg?: number;
  doubleReps?: boolean;
}> = [
  { name: "Bench Press", category: "resistance", equipment: "barbell", defaultWeightKg: 20 },
  { name: "Back Squat", category: "resistance", equipment: "barbell", defaultWeightKg: 20 },
  { name: "Deadlift", category: "resistance", equipment: "barbell", defaultWeightKg: 20 },
  { name: "Overhead Press", category: "resistance", equipment: "barbell", defaultWeightKg: 20 },
  { name: "Barbell Row", category: "resistance", equipment: "barbell", defaultWeightKg: 20 },
  { name: "Bicep Curl", category: "resistance", equipment: "dumbbell" },
  { name: "Tricep Extension", category: "resistance", equipment: "dumbbell" },
  { name: "Lateral Raise", category: "resistance", equipment: "dumbbell" },
  { name: "Pull-Up", category: "resistance", isBodyweight: true },
  { name: "Push-Up", category: "resistance", isBodyweight: true },
  { name: "Run", category: "cardio" },
  { name: "Cycle", category: "cardio" },
  { name: "Row", category: "cardio" },
];

export const DEFAULT_WORKOUT_NAMES = ["Gym", "Run", "Tennis", "Cycle", "Swim", "Yoga"];

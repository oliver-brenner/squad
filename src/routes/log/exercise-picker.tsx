import { useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import type { Exercise } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { ExerciseCard } from "@/components/exercise-card";
import { ExerciseForm } from "@/routes/exercises/exercise-form";
import { ExerciseFilteredList } from "@/components/exercise-filtered-list";

interface Props {
  exercises: Exercise[];
  onPick: (exercise: Exercise) => void;
  onCancel: () => void;
  title?: string;
}

export function ExercisePicker({
  exercises,
  onPick,
  onCancel,
  title = "Add exercise",
}: Props) {
  const [creatingNew, setCreatingNew] = useState(false);

  if (creatingNew) {
    return (
      <ExerciseForm
        onClose={() => setCreatingNew(false)}
        onCreated={(ex) => onPick(ex)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-2 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </header>
      <Button size="lg" className="w-full" onClick={() => setCreatingNew(true)}>
        <Plus className="h-4 w-4" /> New exercise
      </Button>

      <ExerciseFilteredList
        exercises={exercises}
        searchPlaceholder="Search your exercises…"
        renderExercise={(ex) => (
          <ExerciseCard key={ex.id} exercise={ex} onClick={() => onPick(ex)} />
        )}
      />
    </div>
  );
}

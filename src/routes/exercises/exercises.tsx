import { useState, useTransition, useEffect, useMemo } from "react";
import { useQuery } from "@powersync/react";
import { Plus, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import type { Exercise } from "@/lib/db/types";
import type { ExerciseRow } from "@/lib/db/schema";
import { decodeExercise } from "@/lib/db/decoders";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseCard } from "@/components/exercise-card";
import { archiveExercise, unarchiveExercise } from "@/lib/mutations/exercises";
import { PageHeader } from "@/components/nav/page-header";
import { ExerciseForm } from "./exercise-form";
import { ExerciseFilteredList } from "@/components/exercise-filtered-list";

// Mirrors gymtracker's getUserExercisesOrderedByLastLogged: most recently used first.
const EXERCISES_QUERY = `
  SELECT e.*
  FROM exercises e
  ORDER BY
    (SELECT MAX(w.performed_on)
     FROM sets s JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = e.id) DESC NULLS LAST,
    (SELECT MAX(s.position)
     FROM sets s JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = e.id
       AND w.performed_on = (
         SELECT MAX(w2.performed_on)
         FROM sets s2 JOIN workouts w2 ON s2.workout_id = w2.id
         WHERE s2.exercise_id = e.id
       )) DESC NULLS LAST
`;

export function Exercises() {
  const { data: rawRows = [] } = useQuery<ExerciseRow>(EXERCISES_QUERY);
  const exercises = useMemo(() => rawRows.map(decodeExercise), [rawRows]);

  const [editing, setEditing] = useState<Exercise | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuExercise, setMenuExercise] = useState<Exercise | null>(null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const archived = useMemo(() => exercises.filter((e) => e.archivedAt), [exercises]);

  if (creating) {
    return <ExerciseForm onClose={() => setCreating(false)} />;
  }
  if (editing) {
    return <ExerciseForm exercise={editing} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exercises"
        description="Your personal library. Edit, track, or add new."
      />
      <Button onClick={() => setCreating(true)} size="lg" className="w-full">
        <Plus className="h-4 w-4" /> New exercise
      </Button>

      <ExerciseFilteredList
        exercises={exercises}
        renderExercise={(e) => (
          <ExerciseCard
            key={e.id}
            exercise={e}
            href={`/exercises/${e.id}`}
            action={
              <button
                type="button"
                onClick={(ev) => {
                  ev.preventDefault();
                  setMenuExercise(e);
                }}
                className="flex h-full pl-1 pr-3 items-center justify-center text-muted-foreground"
                aria-label={`Options for ${e.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          />
        )}
      />

      {menuExercise && (
        <ExerciseMenu
          onEdit={() => {
            setMenuExercise(null);
            setEditing(menuExercise);
          }}
          onArchive={() => {
            const id = menuExercise.id;
            setMenuExercise(null);
            startTransition(async () => {
              await archiveExercise(id);
            });
          }}
          onClose={() => setMenuExercise(null)}
        />
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Archived
          </h2>
          {archived.map((e) => (
            <Card key={e.id} className="flex items-center gap-3 p-3 opacity-60">
              <div className="min-w-0 flex-1 flex items-center justify-between gap-4">
                <span className="font-medium truncate">{e.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-0.5">
                  <ExerciseMetaTags e={e} />
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await unarchiveExercise(e.id);
                  })
                }
                aria-label={`Restore ${e.name}`}
              >
                <ArchiveRestore className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

function ExerciseMenu({
  onEdit,
  onArchive,
  onClose,
}: {
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col py-4 gap-2 px-4">
          <button
            type="button"
            onClick={onEdit}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Edit exercise
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete exercise
          </button>
        </div>
      </div>
    </>
  );
}

import { useState, useTransition, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { Plus, MoreHorizontal, LayoutTemplate, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import type { Exercise } from "@/lib/db/types";
import type { ExerciseRow } from "@/lib/db/schema";
import { decodeExercise } from "@/lib/db/decoders";
import { Button } from "@/components/ui/button";
import { ExerciseCard } from "@/components/exercise-card";
import { countSetsForExercise, deleteExercise } from "@/lib/mutations/exercises";
import { PageHeader } from "@/components/nav/page-header";
import { ExerciseForm } from "./exercise-form";
import { ExerciseFilteredList } from "@/components/exercise-filtered-list";

// Mirrors gymtracker's getUserExercisesOrderedByLastLogged: most recently used first.
const EXERCISES_QUERY = `
  SELECT e.*
  FROM exercises e
  WHERE e.user_id = ?
  ORDER BY
    (SELECT MAX(w.performed_on)
     FROM sets s JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = e.id AND w.user_id = e.user_id) DESC NULLS LAST,
    (SELECT MAX(s.position)
     FROM sets s JOIN workouts w ON s.workout_id = w.id
     WHERE s.exercise_id = e.id AND w.user_id = e.user_id
       AND w.performed_on = (
         SELECT MAX(w2.performed_on)
         FROM sets s2 JOIN workouts w2 ON s2.workout_id = w2.id
         WHERE s2.exercise_id = e.id AND w2.user_id = e.user_id
       )) DESC NULLS LAST
`;

export function Exercises() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data: rawRows = [] } = useQuery<ExerciseRow>(EXERCISES_QUERY, [userId]);
  const exercises = useMemo(() => rawRows.map(decodeExercise), [rawRows]);

  const [editing, setEditing] = useState<Exercise | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuExercise, setMenuExercise] = useState<Exercise | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // `?open=` re-opens the form after a Customise-fields round-trip.
  // - `new` → opens the create form (in-progress fields aren't preserved)
  // - <uuid> → re-opens the edit form for that exercise
  // We strip the param once consumed so a refresh doesn't keep re-opening.
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (!openParam) return;
    if (openParam === "new") {
      setCreating(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("open");
          return next;
        },
        { replace: true }
      );
      return;
    }
    if (exercises.length === 0) return; // wait for the library to load
    const ex = exercises.find((e) => e.id === openParam);
    if (ex) setEditing(ex);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true }
    );
  }, [openParam, exercises, setSearchParams]);

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
      <Button onClick={() => setCreating(true)} size="lg" className="-mt-2 w-full">
        <Plus className="h-4 w-4" /> New exercise
      </Button>

      <Link
        to="/templates"
        className="-mt-1 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
      >
        <LayoutTemplate className="h-4 w-4" />
        <span className="flex-1">Templates</span>
        <ChevronRight className="h-4 w-4" />
      </Link>

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
          onDelete={() => {
            const id = menuExercise.id;
            const name = menuExercise.name;
            setMenuExercise(null);
            startTransition(async () => {
              const setCount = await countSetsForExercise(id);
              if (setCount > 0) {
                const ok = confirm(
                  `${name} is logged in past sessions. Are you sure you want to delete it? It will disappear from those sessions too.`
                );
                if (!ok) return;
              }
              await deleteExercise(id);
            });
          }}
          onClose={() => setMenuExercise(null)}
        />
      )}
    </div>
  );
}

function ExerciseMenu({
  onEdit,
  onDelete,
  onClose,
}: {
  onEdit: () => void;
  onDelete: () => void;
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
            onClick={onDelete}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete exercise
          </button>
        </div>
      </div>
    </>
  );
}

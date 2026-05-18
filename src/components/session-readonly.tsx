import { useEffect, useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { formatSetSummary, type DistanceUnit } from "@/lib/set-format";

// Read-only renderer shared by the Friends feed session view (current) and
// any future "view-only my own session" mode. Visually mirrors the personal
// log editor's exercise + set layout (same Card structure, meta tags below
// the exercise name, set rows with index + summary) but with all interaction
// stripped — no menu, no drag handle, no edit-on-tap.
//
// Meta tags resolve labels against the EXERCISE OWNER's field options (via
// `ExerciseMetaTags` reading `e.userId`), so a friend's custom categories
// and muscle groups show up exactly as they named them.

export type ReadOnlyExerciseItem = {
  kind: "exercise";
  key: string;
  exerciseId: string;
  exercise: Exercise | null;
  sets: WorkoutSet[];
};

export type ReadOnlyCircuitItem = {
  kind: "circuit";
  key: string;
  name: string;
  rounds: number;
  exercises: Array<{
    exerciseId: string;
    exercise: Exercise | null;
    sets: WorkoutSet[];
  }>;
};

export type ReadOnlyItem = ReadOnlyExerciseItem | ReadOnlyCircuitItem;

// Groups a flat list of sets into the user-visible item structure: single
// exercises and circuits (which themselves group multiple exercises). Same
// rules as the editor's grouping — sets with a `circuitId` collapse into one
// circuit item; sets without one collapse per exercise.
export function buildReadOnlyItems(
  sets: WorkoutSet[],
  exercises: Map<string, Exercise>
): ReadOnlyItem[] {
  const out: ReadOnlyItem[] = [];
  const exerciseIndex = new Map<string, number>();
  const circuitIndex = new Map<string, number>();

  for (const s of sets) {
    if (s.circuitId) {
      let idx = circuitIndex.get(s.circuitId);
      if (idx === undefined) {
        idx = out.length;
        circuitIndex.set(s.circuitId, idx);
        out.push({
          kind: "circuit",
          key: s.circuitId,
          name: s.circuitName ?? "Circuit",
          rounds: s.circuitRounds ?? 1,
          exercises: [],
        });
      }
      const circuit = out[idx] as ReadOnlyCircuitItem;
      let eg = circuit.exercises.find((e) => e.exerciseId === s.exerciseId);
      if (!eg) {
        eg = {
          exerciseId: s.exerciseId,
          exercise: exercises.get(s.exerciseId) ?? null,
          sets: [],
        };
        circuit.exercises.push(eg);
      }
      eg.sets.push(s);
    } else {
      let idx = exerciseIndex.get(s.exerciseId);
      if (idx === undefined) {
        idx = out.length;
        exerciseIndex.set(s.exerciseId, idx);
        out.push({
          kind: "exercise",
          key: `${s.exerciseId}-${idx}`,
          exerciseId: s.exerciseId,
          exercise: exercises.get(s.exerciseId) ?? null,
          sets: [],
        });
      }
      (out[idx] as ReadOnlyExerciseItem).sets.push(s);
    }
  }

  return out;
}

// `onCopyExercise` is the only interactive entry point — supplying it turns
// on a "···" menu next to each exercise (top-level and inside circuits)
// with a Copy action. Friend-session passes it; future own-readonly callers
// can omit it for a purely passive view.
export function SessionReadOnlyItems({
  items,
  onCopyExercise,
}: {
  items: ReadOnlyItem[];
  onCopyExercise?: (exerciseId: string) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No exercises logged.
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) =>
        item.kind === "circuit" ? (
          <CircuitCard
            key={item.key}
            item={item}
            onCopyExercise={onCopyExercise}
          />
        ) : (
          <ExerciseCard
            key={item.key}
            item={item}
            onCopyExercise={onCopyExercise}
          />
        )
      )}
    </div>
  );
}

function ExerciseCard({
  item,
  onCopyExercise,
}: {
  item: ReadOnlyExerciseItem;
  onCopyExercise?: (exerciseId: string) => Promise<void>;
}) {
  const ex = item.exercise;
  return (
    <Card>
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span className="font-medium">{ex?.name ?? "Unknown exercise"}</span>
          {ex && (
            <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
              <ExerciseMetaTags e={ex} />
            </span>
          )}
        </div>
        {onCopyExercise && ex && (
          <ExerciseMenuButton
            exerciseId={item.exerciseId}
            exerciseName={ex.name}
            onCopyExercise={onCopyExercise}
          />
        )}
      </div>
      <div className="px-3 pb-3 flex flex-col gap-0.5">
        {item.sets.map((s, i) => (
          <SetSummary key={s.id} index={i + 1} set={s} exercise={ex} />
        ))}
      </div>
    </Card>
  );
}

function CircuitCard({
  item,
  onCopyExercise,
}: {
  item: ReadOnlyCircuitItem;
  onCopyExercise?: (exerciseId: string) => Promise<void>;
}) {
  return (
    <Card className="border-dashed border-muted-foreground/30">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="font-medium text-primary">{item.name}</span>
          <svg
            viewBox="0 0 6 6"
            width="5"
            height="5"
            fill="currentColor"
            aria-hidden="true"
            className="shrink-0 text-muted-foreground opacity-40"
          >
            <circle cx="3" cy="3" r="2" />
          </svg>
          <span className="font-medium text-primary">
            {item.rounds} {item.rounds === 1 ? "round" : "rounds"}
          </span>
        </div>
      </div>
      <div className="px-3 pb-3 flex flex-col gap-2">
        {item.exercises.map((eg) => (
          <CircuitExerciseRow
            key={eg.exerciseId}
            eg={eg}
            onCopyExercise={onCopyExercise}
          />
        ))}
      </div>
    </Card>
  );
}

function CircuitExerciseRow({
  eg,
  onCopyExercise,
}: {
  eg: ReadOnlyCircuitItem["exercises"][number];
  onCopyExercise?: (exerciseId: string) => Promise<void>;
}) {
  const set = eg.sets[0];
  const hasData =
    set &&
    (set.reps != null ||
      set.weightKg != null ||
      set.durationSec != null ||
      set.distanceKm != null ||
      set.resistance != null ||
      set.speedMs != null ||
      set.inclinePct != null ||
      set.restSec != null);
  const distanceUnit = (eg.exercise?.distanceUnit ?? "km") as DistanceUnit;

  return (
    <div className="flex items-start gap-2 rounded-md px-1 py-1.5">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {eg.exercise?.name ?? "Unknown exercise"}
        </span>
        {eg.exercise && (
          <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
            <ExerciseMetaTags e={eg.exercise} />
          </span>
        )}
        {hasData && eg.exercise && (
          <p className="text-sm mt-3 pl-3 before:content-['•'] before:mr-2 before:text-muted-foreground">
            {formatSetSummary(set, eg.exercise, distanceUnit)}
          </p>
        )}
      </div>
      {onCopyExercise && eg.exercise && (
        <ExerciseMenuButton
          exerciseId={eg.exerciseId}
          exerciseName={eg.exercise.name}
          onCopyExercise={onCopyExercise}
        />
      )}
    </div>
  );
}

function SetSummary({
  index,
  set,
  exercise,
}: {
  index: number;
  set: WorkoutSet;
  exercise: Exercise | null;
}) {
  if (!exercise) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1 py-0.5">
        <span className="text-sm text-muted-foreground w-6 shrink-0 text-center">
          {index}
        </span>
        <span className="flex-1 text-left text-sm py-0.5 text-muted-foreground">—</span>
      </div>
    );
  }
  const distanceUnit = (exercise.distanceUnit ?? "km") as DistanceUnit;
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-0.5">
      <span className="text-sm text-muted-foreground w-6 shrink-0 text-center">
        {index}
      </span>
      <span className="flex-1 text-left text-sm py-0.5">
        {formatSetSummary(set, exercise, distanceUnit)}
      </span>
    </div>
  );
}

function ExerciseMenuButton({
  exerciseId,
  exerciseName,
  onCopyExercise,
}: {
  exerciseId: string;
  exerciseName: string;
  onCopyExercise: (exerciseId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 -mr-1 -mt-1"
        aria-label={`Options for ${exerciseName}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <ExerciseActionsSheet
          exerciseId={exerciseId}
          onCopyExercise={onCopyExercise}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ExerciseActionsSheet({
  exerciseId,
  onCopyExercise,
  onClose,
}: {
  exerciseId: string;
  onCopyExercise: (exerciseId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function handleCopy() {
    setError(null);
    startTransition(async () => {
      try {
        await onCopyExercise(exerciseId);
        setCopied(true);
        // Brief success state, then close. Long enough to register; short
        // enough not to feel sluggish.
        setTimeout(onClose, 900);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't copy exercise");
      }
    });
  }

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
            onClick={handleCopy}
            disabled={pending || copied}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50 disabled:opacity-60"
          >
            {copied ? "Copied to your library" : pending ? "Copying…" : "Copy exercise"}
          </button>
          {error && (
            <p className="text-center text-sm text-red-600 px-2">{error}</p>
          )}
        </div>
      </div>
    </>
  );
}

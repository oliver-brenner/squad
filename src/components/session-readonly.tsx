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

export function SessionReadOnlyItems({ items }: { items: ReadOnlyItem[] }) {
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
          <CircuitCard key={item.key} item={item} />
        ) : (
          <ExerciseCard key={item.key} item={item} />
        )
      )}
    </div>
  );
}

function ExerciseCard({ item }: { item: ReadOnlyExerciseItem }) {
  const ex = item.exercise;
  return (
    <Card>
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span className="font-medium">{ex?.name ?? "Unknown exercise"}</span>
          {ex && (
            <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
              <ExerciseMetaTags e={ex} />
            </span>
          )}
        </div>
      </div>
      <div className="px-3 pb-3 flex flex-col gap-0.5">
        {item.sets.map((s, i) => (
          <SetSummary key={s.id} index={i + 1} set={s} exercise={ex} />
        ))}
      </div>
    </Card>
  );
}

function CircuitCard({ item }: { item: ReadOnlyCircuitItem }) {
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
          <CircuitExerciseRow key={eg.exerciseId} eg={eg} />
        ))}
      </div>
    </Card>
  );
}

function CircuitExerciseRow({
  eg,
}: {
  eg: ReadOnlyCircuitItem["exercises"][number];
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
    <div className="flex items-center gap-2 rounded-md px-1 py-1.5">
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

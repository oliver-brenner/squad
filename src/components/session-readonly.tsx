import { Card } from "@/components/ui/card";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { formatSetSummary, type DistanceUnit } from "@/lib/set-format";

// Read-only renderer shared by the Friends feed session view (current) and
// any future "view-only my own session" mode. Kept independent of the editor
// — the editor has interactive state (drag-drop, set tray, autosave) and a
// different item shape (DraftSet) we don't want to pull into casual read
// surfaces.

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
  return (
    <Card>
      <div className="p-3 border-b border-border">
        <div className="font-medium">{item.exercise?.name ?? "Unknown exercise"}</div>
      </div>
      <div className="p-3 flex flex-col gap-0.5">
        {item.sets.map((s, i) => (
          <SetSummary key={s.id} index={i + 1} set={s} exercise={item.exercise} />
        ))}
      </div>
    </Card>
  );
}

function CircuitCard({ item }: { item: ReadOnlyCircuitItem }) {
  return (
    <Card>
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <div className="font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">{item.rounds}x</div>
      </div>
      <div className="p-3 flex flex-col gap-3">
        {item.exercises.map((eg) => (
          <div key={eg.exerciseId} className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">
              {eg.exercise?.name ?? "Unknown exercise"}
            </div>
            {eg.sets.map((s, i) => (
              <SetSummary key={s.id} index={i + 1} set={s} exercise={eg.exercise} />
            ))}
          </div>
        ))}
      </div>
    </Card>
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
      <div className="flex items-center gap-2 px-1 py-0.5 text-sm">
        <span className="w-6 shrink-0 text-center text-muted-foreground">{index}</span>
        <span className="text-muted-foreground">—</span>
      </div>
    );
  }
  const distanceUnit = (exercise.distanceUnit ?? "km") as DistanceUnit;
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-sm">
      <span className="w-6 shrink-0 text-center text-muted-foreground">{index}</span>
      <span className="flex-1">{formatSetSummary(set, exercise, distanceUnit)}</span>
    </div>
  );
}

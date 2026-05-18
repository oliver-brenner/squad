import { useState, useTransition, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronDown, Plus, MoreHorizontal } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { Exercise, Workout, WorkoutSet, SetWithExerciseRow } from "@/lib/db/types";
import { computeSessionStats, type StatItem } from "@/lib/session-stats";
import { computeExerciseBreakdown } from "@/lib/stats/exercise-breakdown";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import { MuscleGroupsBody, MuscleLegend } from "@/components/stats/training-breakdown";
import { sessionTypeColor } from "@/lib/session-type-color";
import { sanitizeReturnHref } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveWorkout, deleteWorkout } from "@/lib/mutations/workouts";
import { SessionReceiptSheet } from "@/components/session-receipt-sheet";
import { ExerciseForm } from "@/routes/exercises/exercise-form";
import { getWorkoutWithSets, getUserExercisesOrderedByLastLogged } from "@/lib/db/queries";
import { ExercisePicker } from "./exercise-picker";
import { SetRows } from "./set-rows";
import { CircuitRows } from "./circuit-rows";
import {
  isCircuitGroup,
  type CircuitGroup,
  type DraftSet,
  type ExerciseGroup,
  type WorkoutItem,
} from "./workout-editor-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function WorkoutEditorRoute() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<
    | { state: "loading" }
    | { state: "not-found" }
    | { state: "ready"; workout: Workout; sets: WorkoutSet[]; exercises: Exercise[] }
  >({ state: "loading" });

  useEffect(() => {
    if (!id || !UUID_RE.test(id)) {
      setData({ state: "not-found" });
      return;
    }
    (async () => {
      const workout = await getWorkoutWithSets(id);
      if (!workout) {
        setData({ state: "not-found" });
        return;
      }
      const exercises = await getUserExercisesOrderedByLastLogged();
      setData({
        state: "ready",
        workout: workout.workout,
        sets: workout.sets,
        exercises,
      });
    })();
  }, [id]);

  if (data.state === "not-found") return <Navigate to="/log" replace />;
  if (data.state === "loading") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  return (
    <WorkoutEditor
      workout={data.workout}
      formattedDate={format(parseISO(data.workout.performedOn), "EEE d MMM")}
      initialSets={data.sets}
      exercises={data.exercises}
    />
  );
}

interface Props {
  workout: Workout;
  formattedDate: string;
  initialSets: WorkoutSet[];
  exercises: Exercise[];
}

function WorkoutEditor({ workout, formattedDate, initialSets, exercises: initialExercises }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `?from=…` lets the caller decide where Back returns. Friends feed passes
  // `/friends` for own sessions opened there; Log-tab links omit it and
  // fall through to the default `/log`.
  const backHref = sanitizeReturnHref(searchParams.get("from")) ?? "/log";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(workout.name);
  const [isRenaming, setIsRenaming] = useState(false);
  // Local copy of the exercises list so we can reflect inline edits (e.g.
  // renaming or changing tracked metrics via the embedded ExerciseForm)
  // without remounting the route.
  const [exercises, setExercises] = useState(initialExercises);
  const [items, setItems] = useState<WorkoutItem[]>(() => buildItems(initialSets, initialExercises));
  const stats = useMemo(() => {
    const statItems: StatItem[] = items.map((item) =>
      isCircuitGroup(item)
        ? {
            type: "circuit",
            rounds: item.rounds,
            exercises: item.exercises.map((eg) => ({
              sets: eg.sets,
              doubleReps: eg.exercise.doubleReps,
            })),
          }
        : {
            type: "single",
            exercise: { sets: item.sets, doubleReps: item.exercise.doubleReps },
          }
    );
    return computeSessionStats(statItems);
  }, [items]);

  const [picking, setPicking] = useState(false);
  const [pickingForCircuit, setPickingForCircuit] = useState<string | null>(null);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const { muscleGroups } = useUserFieldOptions();
  const breakdown = useMemo(() => {
    const rows: SetWithExerciseRow[] = [];
    for (const item of items) {
      if (isCircuitGroup(item)) {
        for (const eg of item.exercises) {
          for (const s of eg.sets) {
            rows.push({
              set: toWorkoutSet(s, eg.exerciseId, workout.id, workout.userId, workout.performedOn),
              exercise: eg.exercise,
              performedOn: workout.performedOn,
              workoutId: workout.id,
            });
          }
        }
      } else {
        for (const s of item.sets) {
          rows.push({
            set: toWorkoutSet(s, item.exerciseId, workout.id, workout.userId, workout.performedOn),
            exercise: item.exercise,
            performedOn: workout.performedOn,
            workoutId: workout.id,
          });
        }
      }
    }
    return computeExerciseBreakdown(rows, muscleGroups);
  }, [items, muscleGroups, workout.id, workout.performedOn]);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el || isRenaming) return;

    const fit = () => {
      el.style.fontSize = "1.875rem";
      const min = 14;
      let size = 30;
      while (el.scrollWidth > el.clientWidth && size > min) {
        size--;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, isRenaming]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef({ name, items });

  useEffect(() => {
    latestStateRef.current = { name, items };
  }, [name, items]);

  const buildSavePayload = useCallback(() => {
    const { name: n, items: it } = latestStateRef.current;
    const flatSets = it.flatMap((item, itemIndex) => {
      if (isCircuitGroup(item)) {
        return item.exercises.flatMap((eg, exIdx) =>
          eg.sets.map((s, si) => ({
            id: s.id,
            exerciseId: eg.exerciseId,
            position: itemIndex * 1000 + exIdx * 10 + si,
            reps: s.reps,
            weightKg: s.weightKg,
            distanceKm: s.distanceKm,
            durationSec: s.durationSec,
            resistance: s.resistance,
            speedMs: s.speedMs,
            inclinePct: s.inclinePct,
            restSec: s.restSec,
            circuitId: item.groupKey,
            circuitRounds: item.rounds,
            circuitName: item.name,
          }))
        );
      } else {
        return item.sets.map((s, si) => ({
          id: s.id,
          exerciseId: item.exerciseId,
          position: itemIndex * 1000 + si,
          reps: s.reps,
          weightKg: s.weightKg,
          distanceKm: s.distanceKm,
          durationSec: s.durationSec,
          resistance: s.resistance,
          speedMs: s.speedMs,
          inclinePct: s.inclinePct,
          restSec: s.restSec,
          circuitId: null as string | null,
          circuitRounds: null as number | null,
          circuitName: null as string | null,
        }));
      }
    });
    return {
      id: workout.id,
      name: n.trim() || "Workout",
      performedOn: workout.performedOn,
      notes: null,
      sets: flatSets,
    };
  }, [workout.id, workout.performedOn]);

  const doSave = useCallback(() => {
    setError(null);
    const payload = buildSavePayload();
    startTransition(async () => {
      try {
        await saveWorkout(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }, [buildSavePayload]);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(doSave, 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [name, items, doSave]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((g) => g.groupKey === active.id);
      const newIndex = prev.findIndex((g) => g.groupKey === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function addExercise(ex: Exercise) {
    setExercises((prev) => (prev.some((e) => e.id === ex.id) ? prev : [ex, ...prev]));
    setItems((prev) => [
      ...prev,
      {
        groupKey: crypto.randomUUID(),
        exerciseId: ex.id,
        exercise: ex,
        sets: [emptySet(ex)],
      },
    ]);
    setPicking(false);
  }

  function addCircuit() {
    setItems((prev) => [
      ...prev,
      {
        groupKey: crypto.randomUUID(),
        name: "Circuit",
        rounds: 1,
        exercises: [],
      },
    ]);
  }

  function addExerciseToCircuit(circuitKey: string, ex: Exercise) {
    setExercises((prev) => (prev.some((e) => e.id === ex.id) ? prev : [ex, ...prev]));
    setItems((prev) =>
      prev.map((item) => {
        if (!isCircuitGroup(item) || item.groupKey !== circuitKey) return item;
        if (item.exercises.some((e) => e.exerciseId === ex.id)) return item;
        const newEg: ExerciseGroup = {
          groupKey: crypto.randomUUID(),
          exerciseId: ex.id,
          exercise: ex,
          sets: [emptySet(ex)],
        };
        return { ...item, exercises: [...item.exercises, newEg] };
      })
    );
    setPickingForCircuit(null);
  }

  function updateItem(groupKey: string, updater: (item: WorkoutItem) => WorkoutItem) {
    setItems((prev) => prev.map((item) => (item.groupKey === groupKey ? updater(item) : item)));
  }

  function removeItem(groupKey: string) {
    setItems((prev) => prev.filter((item) => item.groupKey !== groupKey));
  }

  function applyExerciseUpdate(updated: Exercise) {
    setExercises((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setItems((prev) =>
      prev.map((item) => {
        if (isCircuitGroup(item)) {
          return {
            ...item,
            exercises: item.exercises.map((eg) =>
              eg.exerciseId === updated.id ? { ...eg, exercise: updated } : eg
            ),
          };
        }
        if (item.exerciseId === updated.id) {
          return { ...item, exercise: updated };
        }
        return item;
      })
    );
  }

  function confirmRename() {
    setIsRenaming(false);
    if (!name.trim()) setName(workout.name);
  }

  const isPickingForCircuit = pickingForCircuit !== null;

  if (picking || isPickingForCircuit) {
    return (
      <ExercisePicker
        exercises={exercises}
        title={isPickingForCircuit ? "Add to circuit" : "Add exercise"}
        onPick={(ex) => {
          if (isPickingForCircuit) {
            addExerciseToCircuit(pickingForCircuit!, ex);
          } else {
            addExercise(ex);
          }
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
        onCancel={() => {
          setPicking(false);
          setPickingForCircuit(null);
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
      />
    );
  }

  if (editingExercise) {
    return (
      <ExerciseForm
        exercise={editingExercise}
        onUpdated={applyExerciseUpdate}
        onClose={() => {
          setEditingExercise(null);
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex items-center gap-1 pt-4 pb-0">
        <Link
          to={backHref}
          onClick={() => {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
              saveWorkout(buildSavePayload()).catch(() => {});
            }
          }}
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <div className="flex flex-1 min-w-0 items-center">
          {isRenaming ? (
            <Input
              ref={renameInputRef}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
              }}
              className="text-lg font-semibold h-8 px-1"
            />
          ) : (
            <button
              ref={titleRef}
              type="button"
              onClick={() => setIsRenaming(true)}
              className="whitespace-nowrap overflow-hidden text-3xl font-semibold tracking-tight text-left w-full"
            >
              {name || "Workout"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
          <span className="text-base text-muted-foreground">{formattedDate}</span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Session options"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>

        {menuOpen && (
          <WorkoutMenu
            workoutId={workout.id}
            onClose={() => setMenuOpen(false)}
            onExport={() => setReceiptOpen(true)}
            onDelete={() => {
              startTransition(async () => {
                await deleteWorkout(workout.id);
                navigate("/log");
              });
            }}
          />
        )}
        {receiptOpen && (
          <SessionReceiptSheet workoutId={workout.id} onClose={() => setReceiptOpen(false)} />
        )}
      </header>

      {items.length > 0 && (
        <div className="flex items-center gap-1.5">
          {[
            { value: stats.exercises, label: "exercises" },
            { value: stats.totalSets, label: "sets" },
            ...(stats.totalReps > 0 ? [{ value: stats.totalReps, label: "reps" }] : []),
          ].map(({ value, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70"
            >
              <span className="font-semibold tabular-nums text-foreground/60">{value}</span>
              {label}
            </span>
          ))}
        </div>
      )}

      {items.length > 0 && breakdown.totalExercises > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setBreakdownOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30"
            aria-expanded={breakdownOpen}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Muscle groups
            </span>
            <div className="flex items-center gap-3">
              {breakdownOpen && <MuscleLegend size="sm" />}
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  breakdownOpen ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>
          {breakdownOpen && (
            <div className="px-4 pb-4">
              <MuscleGroupsBody data={breakdown} />
            </div>
          )}
        </div>
      )}

      <div className={`h-1.5 rounded-full my-2 ${sessionTypeColor(workout.sessionType)}`} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={items.map((g) => g.groupKey)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => {
            if (isCircuitGroup(item)) {
              return (
                <CircuitRows
                  key={item.groupKey}
                  circuit={item}
                  workoutId={workout.id}
                  onUpdate={(next) => updateItem(item.groupKey, () => next)}
                  onRemove={() => removeItem(item.groupKey)}
                  onAddExercise={() => {
                    setPickingForCircuit(item.groupKey);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                  onEditExercise={(exercise) => {
                    setEditingExercise(exercise);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                />
              );
            }
            return (
              <SetRows
                key={item.groupKey}
                group={item as ExerciseGroup}
                workoutId={workout.id}
                onUpdate={(next) => updateItem(item.groupKey, () => next)}
                onRemove={() => removeItem(item.groupKey)}
                onEdit={() => {
                  setEditingExercise((item as ExerciseGroup).exercise);
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setPicking(true);
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
          className="flex-1"
        >
          <Plus className="h-4 w-4" />{" "}
          <span className="whitespace-nowrap text-[clamp(0.75rem,3.5vw,1rem)]">Add exercise</span>
        </Button>
        <Button variant="outline" size="lg" onClick={addCircuit} className="flex-1">
          <Plus className="h-4 w-4" />{" "}
          <span className="whitespace-nowrap text-[clamp(0.75rem,3.5vw,1rem)]">Add circuit</span>
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && null}
    </div>
  );
}

function toWorkoutSet(
  s: DraftSet,
  exerciseId: string,
  workoutId: string,
  userId: string,
  performedOn: string
): WorkoutSet {
  return {
    id: s.id ?? "",
    userId,
    performedOn,
    workoutId,
    exerciseId,
    position: 0,
    reps: s.reps,
    weightKg: s.weightKg,
    distanceKm: s.distanceKm,
    durationSec: s.durationSec,
    resistance: s.resistance,
    speedMs: s.speedMs,
    inclinePct: s.inclinePct,
    restSec: s.restSec,
    circuitId: null,
    circuitRounds: null,
    circuitName: null,
  };
}

function WorkoutMenu({
  workoutId,
  onClose,
  onExport,
  onDelete,
}: {
  workoutId: string;
  onClose: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
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
            onClick={() => {
              onClose();
              navigate(`/log/${workoutId}/edit?returnTo=/log/${workoutId}`);
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onExport();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Export receipt
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete session
          </button>
        </div>
      </div>
    </>
  );
}

function emptySet(ex: Exercise): DraftSet {
  return {
    exerciseId: ex.id,
    reps: null,
    weightKg: null,
    distanceKm: null,
    durationSec: null,
    resistance: null,
    speedMs: null,
    inclinePct: null,
    restSec: null,
  };
}

function buildItems(sets: WorkoutSet[], exercises: Exercise[]): WorkoutItem[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const result: WorkoutItem[] = [];
  const exerciseIndexes = new Map<string, number>();
  const circuitIndexes = new Map<string, number>();

  for (const s of sets) {
    const ex = byId.get(s.exerciseId);
    if (!ex) continue;

    const draft: DraftSet = {
      id: s.id,
      exerciseId: s.exerciseId,
      reps: s.reps,
      weightKg: s.weightKg,
      distanceKm: s.distanceKm,
      durationSec: s.durationSec,
      resistance: s.resistance,
      speedMs: s.speedMs,
      inclinePct: s.inclinePct,
      restSec: s.restSec,
    };

    if (s.circuitId) {
      if (!circuitIndexes.has(s.circuitId)) {
        circuitIndexes.set(s.circuitId, result.length);
        result.push({
          groupKey: s.circuitId,
          name: s.circuitName ?? "Circuit",
          rounds: s.circuitRounds ?? 1,
          exercises: [],
        });
      }
      const circuit = result[circuitIndexes.get(s.circuitId)!] as CircuitGroup;
      let eg = circuit.exercises.find((e) => e.exerciseId === ex.id);
      if (!eg) {
        eg = {
          groupKey: crypto.randomUUID(),
          exerciseId: ex.id,
          exercise: ex,
          sets: [],
        };
        circuit.exercises.push(eg);
      }
      eg.sets.push(draft);
    } else {
      if (!exerciseIndexes.has(ex.id)) {
        exerciseIndexes.set(ex.id, result.length);
        result.push({
          groupKey: ex.id,
          exerciseId: ex.id,
          exercise: ex,
          sets: [],
        });
      }
      (result[exerciseIndexes.get(ex.id)!] as ExerciseGroup).sets.push(draft);
    }
  }

  return result;
}

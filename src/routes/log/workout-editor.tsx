import { useState, useTransition, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronDown, Plus, MoreHorizontal, Globe, Lock, X } from "lucide-react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { Exercise, Workout, WorkoutSet, SetWithExerciseRow } from "@/lib/db/types";
import { computeSessionStats, type StatItem } from "@/lib/session-stats";
import { computeExerciseBreakdown } from "@/lib/stats/exercise-breakdown";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import { useTimer } from "@/components/providers/timer-provider";
import { MuscleGroupsBody, MuscleLegend } from "@/components/stats/training-breakdown";
import { sessionTypeColor } from "@/lib/session-type-color";
import { sanitizeReturnHref } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteTray } from "@/components/note-field";
import { saveWorkout, deleteWorkout } from "@/lib/mutations/workouts";
import { SessionReceiptSheet } from "@/components/session-receipt-sheet";
import { SessionGuests } from "@/components/session-guests";
import { ExerciseForm } from "@/routes/exercises/exercise-form";
import { getWorkoutWithSets, getUserExercisesOrderedByLastLogged } from "@/lib/db/queries";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeProfile } from "@/lib/db/decoders";
import type { ProfileRow } from "@/lib/db/schema";
import { ExercisePicker } from "./exercise-picker";
import { SetRows } from "./set-rows";
import { CircuitRows } from "./circuit-rows";
import { CalorieTray } from "./calorie-tray";
import {
  isCircuitGroup,
  type DraftSet,
  type ExerciseGroup,
  type WorkoutItem,
} from "./workout-editor-types";
import {
  ROOT,
  buildItemsFromSets,
  emptySet,
  findContainer,
  findExerciseGroupAnywhere,
  flattenItems,
  insertExerciseIntoContainer,
  removeExerciseFromContainer,
} from "./exercise-items";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Device-wide preference: show every session's exercise list bottom-to-top.
const REVERSE_ORDER_KEY = "squad.reverseExerciseOrder";

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
  const [notes, setNotes] = useState(workout.notes);
  const [notesPublic, setNotesPublic] = useState(workout.notesPublic);
  const [guestCount, setGuestCount] = useState(0);
  const [noteTrayOpen, setNoteTrayOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  // Local copy of the exercises list so we can reflect inline edits (e.g.
  // renaming or changing tracked metrics via the embedded ExerciseForm)
  // without remounting the route.
  const [exercises, setExercises] = useState(initialExercises);
  const [items, setItems] = useState<WorkoutItem[]>(() =>
    buildItemsFromSets(initialSets, initialExercises)
  );
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
  // Set when an exercise is added to the session so the editor scrolls down to
  // the freshly-appended entry once it has rendered (rather than to the top).
  const scrollToBottomRef = useRef(false);

  // Session-level calories. Gated on the user's "Enable calorie tracking"
  // setting. Saved independently of the debounced set autosave, so we keep a
  // local copy of the value to drive the pill without a refetch.
  const { user } = useAuth();
  const { data: profileRows } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [user?.id ?? ""]
  );
  const calorieTrackingEnabled =
    profileRows[0] ? decodeProfile(profileRows[0]).calorieTrackingEnabled : false;
  const [calories, setCalories] = useState(workout.calories);
  const [calorieTrayOpen, setCalorieTrayOpen] = useState(false);
  // When enabled, the exercise list is shown bottom-to-top and the add buttons
  // move up directly below the session-type bar. Persisted device-wide so the
  // preference carries across every session until toggled off.
  const [reversed, setReversed] = useState(() => {
    try {
      return localStorage.getItem(REVERSE_ORDER_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleReversed = useCallback(() => {
    setReversed((v) => {
      const next = !v;
      try {
        localStorage.setItem(REVERSE_ORDER_KEY, next ? "1" : "0");
      } catch {
        // localStorage may be unavailable (private mode); keep the in-memory value
      }
      return next;
    });
  }, []);

  // After adding an exercise, the picker view unmounts and the editor re-renders
  // with the new entry appended. Scroll to it here, once it's in the DOM. When
  // the list is reversed the new entry sits at the top, so scroll there instead.
  useEffect(() => {
    if (!picking && !pickingForCircuit && scrollToBottomRef.current) {
      scrollToBottomRef.current = false;
      window.scrollTo({
        top: reversed ? 0 : document.documentElement.scrollHeight,
        behavior: "instant",
      });
    }
  }, [items, picking, pickingForCircuit, reversed]);

  const { muscleGroups } = useUserFieldOptions();
  const timer = useTimer();
  const timerRef = useRef(timer);
  timerRef.current = timer;
  useEffect(() => {
    // Returning to the session: a rest timer that finished while away is stale,
    // so close it rather than reopening the "Rest complete" module.
    if (timerRef.current.mode === "rest" && timerRef.current.completed) {
      timerRef.current.dismiss();
    }
    // Leaving the session: close the timer unless it's still running — a running
    // timer (rest or free) keeps going in the background and reopens on return;
    // an idle/paused/finished one is cleared so it's closed by default.
    return () => {
      if (!timerRef.current.running) timerRef.current.dismiss();
    };
  }, []);
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
  const latestStateRef = useRef({ name, notes, notesPublic, items });

  useEffect(() => {
    latestStateRef.current = { name, notes, notesPublic, items };
  }, [name, notes, notesPublic, items]);

  const buildSavePayload = useCallback(() => {
    const { name: n, notes: nt, notesPublic: np, items: it } = latestStateRef.current;
    return {
      id: workout.id,
      name: n.trim() || "Workout",
      performedOn: workout.performedOn,
      notes: nt,
      notesPublic: np,
      sets: flattenItems(it),
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
  }, [name, notes, notesPublic, items, doSave]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } })
  );

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setItems((prev) => {
      const activeContainer = findContainer(activeId, prev);
      const overContainer = findContainer(overId, prev);
      if (!activeContainer || !overContainer) return prev;
      if (activeContainer === overContainer) return prev;

      const activeItem = findExerciseGroupAnywhere(activeId, prev);
      if (!activeItem) return prev;

      const without = removeExerciseFromContainer(prev, activeId);
      return insertExerciseIntoContainer(without, activeItem, overContainer, overId);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    setItems((prev) => {
      const activeContainer = findContainer(activeId, prev);
      const overContainer = findContainer(overId, prev);
      if (!activeContainer || !overContainer) return prev;
      if (activeContainer !== overContainer) return prev;

      if (activeContainer === ROOT) {
        const oldIndex = prev.findIndex((g) => g.groupKey === activeId);
        const newIndex = prev.findIndex((g) => g.groupKey === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      }

      return prev.map((item) => {
        if (!isCircuitGroup(item) || item.groupKey !== activeContainer) return item;
        const oldIndex = item.exercises.findIndex((eg) => eg.groupKey === activeId);
        const newIndex = item.exercises.findIndex((eg) => eg.groupKey === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return item;
        return { ...item, exercises: arrayMove(item.exercises, oldIndex, newIndex) };
      });
    });
  }

  function addExercise(ex: Exercise) {
    scrollToBottomRef.current = true;
    setExercises((prev) => (prev.some((e) => e.id === ex.id) ? prev : [ex, ...prev]));
    setItems((prev) => [
      ...prev,
      {
        groupKey: crypto.randomUUID(),
        exerciseId: ex.id,
        exercise: ex,
        sets: [emptySet(ex)],
        variation: null,
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
        rounds: 0,
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
          variation: null,
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
            window.scrollTo({ top: 0, behavior: "instant" });
          } else {
            // addExercise appends to the bottom; the scroll-to-bottom effect
            // takes us there once the editor re-renders with the new entry.
            addExercise(ex);
          }
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

  const displayItems = reversed ? [...items].reverse() : items;

  const addButtons = (
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
  );

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
            onAddTimer={!timer.active ? () => timer.startFree() : undefined}
            onToggleReverse={toggleReversed}
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
        <div className="flex flex-wrap items-center gap-1.5">
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
          {calorieTrackingEnabled &&
            (calories != null ? (
              <button
                type="button"
                onClick={() => setCalorieTrayOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70"
              >
                <span className="font-semibold tabular-nums text-foreground/60">{calories}</span>
                cals
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCalorieTrayOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground/70 hover:bg-muted/60"
              >
                + add cals
              </button>
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

      <SessionNoteRow
        guestCount={guestCount}
        notes={notes}
        notesPublic={notesPublic}
        onGuestCountChange={setGuestCount}
        onOpenTray={() => setNoteTrayOpen(true)}
        onDeleteNote={() => { setNotes(null); }}
        workoutId={workout.id}
        backHref={`/log/${workout.id}`}
      />

      {noteTrayOpen && (
        <NoteTray
          initialValue={notes}
          initialPublic={notesPublic}
          placeholder="Add a note for this session…"
          onConfirm={(v, p) => {
            setNotes(v);
            setNotesPublic(p);
            setNoteTrayOpen(false);
          }}
          onClose={() => setNoteTrayOpen(false)}
        />
      )}

      <div className={`h-1.5 rounded-full ${sessionTypeColor(workout.sessionType)}`} />

      {reversed && addButtons}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayItems.map((g) => g.groupKey)}
          strategy={verticalListSortingStrategy}
        >
          {displayItems.map((item) => {
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

      {!reversed && addButtons}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && null}

      {calorieTrayOpen && (
        <CalorieTray
          workoutId={workout.id}
          current={calories}
          onClose={() => setCalorieTrayOpen(false)}
          onSaved={(value) => {
            setCalories(value);
            setCalorieTrayOpen(false);
          }}
        />
      )}
    </div>
  );
}

const ADD_NOTE_BTN_CLS =
  "flex items-center gap-1.5 rounded-xl border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

function SessionNoteRow({
  guestCount,
  notes,
  notesPublic,
  onGuestCountChange,
  onOpenTray,
  onDeleteNote,
  workoutId,
  backHref,
}: {
  guestCount: number;
  notes: string | null;
  notesPublic: boolean;
  onGuestCountChange: (n: number) => void;
  onOpenTray: () => void;
  onDeleteNote: () => void;
  workoutId: string;
  backHref: string;
}) {
  const hasGuests = guestCount > 0;
  const hasNote = !!notes && notes.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: guests + inline add-note when no guests and no note yet */}
      <div className="flex items-center gap-2 flex-wrap">
        <SessionGuests
          workoutId={workoutId}
          variant="page"
          backHref={backHref}
          editable
          onGuestCountChange={onGuestCountChange}
        />
        {!hasGuests && !hasNote && (
          <button type="button" onClick={onOpenTray} className={ADD_NOTE_BTN_CLS}>
            <Plus className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">Add note</span>
          </button>
        )}
      </div>

      {/* Row 2: add-note button below when guests exist but no note yet */}
      {hasGuests && !hasNote && (
        <button type="button" onClick={onOpenTray} className={`self-start ${ADD_NOTE_BTN_CLS}`}>
          <Plus className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">Add note</span>
        </button>
      )}

      {/* Note bubble: always its own row when note exists */}
      {hasNote && (
        <div className="w-full rounded-xl bg-muted/50 px-3 py-2 text-sm flex items-center gap-2">
          {notesPublic ? (
            <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <button
            type="button"
            onClick={onOpenTray}
            className="flex-1 whitespace-pre-wrap text-left"
          >
            {notes}
          </button>
          <button
            type="button"
            onClick={onDeleteNote}
            aria-label="Delete note"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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
    calories: s.calories,
    rpe: s.rpe,
    circuitId: null,
    circuitRounds: null,
    circuitName: null,
    variation: null,
  };
}

function WorkoutMenu({
  workoutId,
  onClose,
  onExport,
  onDelete,
  onAddTimer,
  onToggleReverse,
}: {
  workoutId: string;
  onClose: () => void;
  onExport: () => void;
  onDelete: () => void;
  onAddTimer?: () => void;
  onToggleReverse: () => void;
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
          {onAddTimer && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddTimer();
              }}
              className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
            >
              Add timer
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onToggleReverse();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Reverse exercise order
          </button>
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
              navigate(`/templates/new?fromWorkout=${workoutId}`);
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Save as Template
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


import { useState, useTransition, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { ChevronLeft, Plus, MoreHorizontal } from "lucide-react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import type { Exercise, Template, TemplateSet } from "@/lib/db/types";
import type { SessionType } from "@/lib/db/schema";
import { sessionTypeColor } from "@/lib/session-type-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteField } from "@/components/note-field";
import {
  createTemplate,
  createTemplateFromWorkout,
  saveTemplate,
  deleteTemplate,
} from "@/lib/mutations/templates";
import { getTemplateWithSets, getUserExercisesOrderedByLastLogged } from "@/lib/db/queries";
import { ExerciseForm } from "@/routes/exercises/exercise-form";
import { ExercisePicker } from "@/routes/log/exercise-picker";
import { SetRows } from "@/routes/log/set-rows";
import { CircuitRows } from "@/routes/log/circuit-rows";
import { isCircuitGroup, type ExerciseGroup, type WorkoutItem } from "@/routes/log/workout-editor-types";
import {
  ROOT,
  buildItemsFromSets,
  emptySet,
  findContainer,
  findExerciseGroupAnywhere,
  flattenItems,
  insertExerciseIntoContainer,
  removeExerciseFromContainer,
} from "@/routes/log/exercise-items";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: "workout", label: "Workout" },
  { value: "stretch", label: "Stretch" },
  { value: "sport", label: "Sport" },
  { value: "lifestyle", label: "Other" },
];

// `/templates/new` — mints a template (blank, or a skeleton copied from a
// session via ?fromWorkout=) then redirects to its editor. Mirrors how
// `/log/new` creates a workout and forwards to `/log/:id`.
export function NewTemplate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromWorkout = searchParams.get("fromWorkout") ?? undefined;
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const id = fromWorkout
          ? await createTemplateFromWorkout({ workoutId: fromWorkout })
          : await createTemplate({ name: "Template", sessionType: "workout" });
        navigate(`/templates/${id}`, { replace: true });
      } catch (err) {
        console.error("[new-template] failed to create template:", err);
        navigate("/templates", { replace: true });
      }
    })();
  }, [fromWorkout, navigate]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
    </div>
  );
}

export function TemplateEditorRoute() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<
    | { state: "loading" }
    | { state: "not-found" }
    | { state: "ready"; template: Template; sets: TemplateSet[]; exercises: Exercise[] }
  >({ state: "loading" });

  useEffect(() => {
    if (!id || !UUID_RE.test(id)) {
      setData({ state: "not-found" });
      return;
    }
    (async () => {
      const loaded = await getTemplateWithSets(id);
      if (!loaded) {
        setData({ state: "not-found" });
        return;
      }
      const exercises = await getUserExercisesOrderedByLastLogged();
      setData({
        state: "ready",
        template: loaded.template,
        sets: loaded.sets,
        exercises,
      });
    })();
  }, [id]);

  if (data.state === "not-found") return <Navigate to="/templates" replace />;
  if (data.state === "loading") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  return (
    <TemplateEditor template={data.template} initialSets={data.sets} exercises={data.exercises} />
  );
}

interface Props {
  template: Template;
  initialSets: TemplateSet[];
  exercises: Exercise[];
}

function TemplateEditor({ template, initialSets, exercises: initialExercises }: Props) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(template.name);
  const [notes, setNotes] = useState(template.notes);
  const [notesPublic, setNotesPublic] = useState(template.notesPublic);
  const [isRenaming, setIsRenaming] = useState(false);
  const [sessionType, setSessionType] = useState<SessionType>(template.sessionType);
  const [exercises, setExercises] = useState(initialExercises);
  const [items, setItems] = useState<WorkoutItem[]>(() =>
    buildItemsFromSets(initialSets, initialExercises)
  );

  const [picking, setPicking] = useState(false);
  const [pickingForCircuit, setPickingForCircuit] = useState<string | null>(null);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollToBottomRef = useRef(false);

  const stats = useMemo(() => {
    let exerciseCount = 0;
    let setCount = 0;
    for (const item of items) {
      if (isCircuitGroup(item)) {
        for (const eg of item.exercises) {
          exerciseCount++;
          setCount += eg.sets.length;
        }
      } else {
        exerciseCount++;
        setCount += item.sets.length;
      }
    }
    return { exerciseCount, setCount };
  }, [items]);

  useEffect(() => {
    if (!picking && !pickingForCircuit && scrollToBottomRef.current) {
      scrollToBottomRef.current = false;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    }
  }, [items, picking, pickingForCircuit]);

  // Debounced autosave — same 1s-after-last-change pattern as the workout editor.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef({ name, notes, notesPublic, sessionType, items });
  useEffect(() => {
    latestStateRef.current = { name, notes, notesPublic, sessionType, items };
  }, [name, notes, notesPublic, sessionType, items]);

  const buildSavePayload = useCallback(() => {
    const { name: n, notes: nt, notesPublic: np, sessionType: st, items: it } =
      latestStateRef.current;
    return {
      id: template.id,
      name: n.trim() || "Template",
      sessionType: st,
      notes: nt,
      notesPublic: np,
      sets: flattenItems(it),
    };
  }, [template.id]);

  const doSave = useCallback(() => {
    setError(null);
    const payload = buildSavePayload();
    startTransition(async () => {
      try {
        await saveTemplate(payload);
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
  }, [name, notes, notesPublic, sessionType, items, doSave]);

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
        notes: null,
        notesPublic: true,
      },
    ]);
    setPicking(false);
  }

  function addCircuit() {
    setItems((prev) => [
      ...prev,
      { groupKey: crypto.randomUUID(), name: "Circuit", rounds: 0, exercises: [] },
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
          notes: null,
          notesPublic: true,
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
        if (item.exerciseId === updated.id) return { ...item, exercise: updated };
        return item;
      })
    );
  }

  function confirmRename() {
    setIsRenaming(false);
    if (!name.trim()) setName(template.name);
  }

  function saveNow() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveTemplate(buildSavePayload()).catch(() => {});
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

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex items-center gap-1 pt-4 pb-0">
        <Link
          to="/templates"
          onClick={saveNow}
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <div className="flex flex-1 min-w-0 items-center">
          {isRenaming ? (
            <Input
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
              type="button"
              onClick={() => setIsRenaming(true)}
              className="whitespace-nowrap overflow-hidden text-2xl font-semibold tracking-tight text-left w-full"
            >
              {name || "Template"}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted flex-shrink-0 ml-3"
          aria-label="Template options"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>

        {menuOpen && (
          <TemplateMenu
            onClose={() => setMenuOpen(false)}
            onCreateSession={() => {
              saveNow();
              navigate(`/log/new?template=${template.id}`);
            }}
            onDelete={() => {
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              startTransition(async () => {
                await deleteTemplate(template.id);
                navigate("/templates");
              });
            }}
          />
        )}
      </header>

      <p className="text-sm text-muted-foreground">
        A reusable template.
        <br />
        Add exercises and optionally pre-fill sets.
      </p>

      <div className="grid grid-cols-4 rounded-2xl border border-border overflow-hidden">
        {SESSION_TYPES.map(({ value, label }, i) => (
          <button
            key={value}
            type="button"
            onClick={() => setSessionType(value)}
            className={`py-3 text-sm font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              sessionType === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { value: stats.exerciseCount, label: "exercises" },
            { value: stats.setCount, label: "sets" },
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

      <NoteField
        value={notes}
        isPublic={notesPublic}
        onChange={(v, p) => {
          setNotes(v);
          setNotesPublic(p);
        }}
        placeholder="Add a note for this template…"
      />

      <div className={`h-1.5 rounded-full my-2 ${sessionTypeColor(sessionType)}`} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((g) => g.groupKey)} strategy={verticalListSortingStrategy}>
          {items.map((item) => {
            if (isCircuitGroup(item)) {
              return (
                <CircuitRows
                  key={item.groupKey}
                  circuit={item}
                  workoutId={template.id}
                  mode="template"
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
                workoutId={template.id}
                mode="template"
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

function TemplateMenu({
  onClose,
  onCreateSession,
  onDelete,
}: {
  onClose: () => void;
  onCreateSession: () => void;
  onDelete: () => void;
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
            onClick={() => {
              onClose();
              onCreateSession();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Create session from template
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete template
          </button>
        </div>
      </div>
    </>
  );
}

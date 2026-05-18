import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, Minus, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import type { Exercise } from "@/lib/db/types";
import { circuitBodyId, type DraftSet, type ExerciseGroup, type CircuitGroup } from "./workout-editor-types";
import { SetTray } from "./set-rows";

interface Props {
  circuit: CircuitGroup;
  workoutId: string;
  onUpdate: (next: CircuitGroup) => void;
  onRemove: () => void;
  onAddExercise: () => void;
  onEditExercise: (exercise: Exercise) => void;
}

export function CircuitRows({
  circuit,
  workoutId,
  onUpdate,
  onRemove,
  onAddExercise,
  onEditExercise,
}: Props) {
  const [activeTray, setActiveTray] = useState<{ exIdx: number; draft: DraftSet } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: circuit.groupKey });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const { setNodeRef: setBodyDroppableRef, isOver: isBodyOver } = useDroppable({
    id: circuitBodyId(circuit.groupKey),
  });

  function openSetTray(exIdx: number) {
    const eg = circuit.exercises[exIdx];
    const existing = eg.sets[0];
    const draft: DraftSet = existing
      ? { ...existing }
      : {
          exerciseId: eg.exerciseId,
          reps: null,
          weightKg: null,
          distanceKm: null,
          durationSec: null,
          resistance: null,
          speedMs: null,
          inclinePct: null,
          restSec: null,
        };
    setActiveTray({ exIdx, draft });
  }

  function confirmSetTray(draft: DraftSet) {
    if (!activeTray) return;
    const nextExercises = circuit.exercises.map((eg, i) =>
      i === activeTray.exIdx ? { ...eg, sets: [{ ...eg.sets[0], ...draft }] } : eg
    );
    onUpdate({ ...circuit, exercises: nextExercises });
    setActiveTray(null);
  }

  function removeExercise(exIdx: number) {
    const next = circuit.exercises.filter((_, i) => i !== exIdx);
    if (next.length === 0) {
      onRemove();
      return;
    }
    onUpdate({ ...circuit, exercises: next });
  }

  return (
    <>
      <div ref={setNodeRef} style={dragStyle}>
        <Card className="border-dashed border-muted-foreground/30">
          <div
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="flex items-start gap-3 px-3 pt-3 pb-2"
          >
            <div className="flex-1 min-w-0">
              <div className="float-right ml-3 flex items-center gap-2 shrink-0">
                <span className="text-base font-medium text-primary">
                  {circuit.rounds} {circuit.rounds === 1 ? "round" : "rounds"}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ ...circuit, rounds: Math.max(0, circuit.rounds - 1) });
                  }}
                  disabled={circuit.rounds <= 0}
                  className="h-6 w-6 shrink-0 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-white"
                  aria-label="Decrease rounds"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ ...circuit, rounds: Math.min(999, circuit.rounds + 1) });
                  }}
                  className="h-6 w-6 shrink-0 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90"
                  aria-label="Increase rounds"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {renamingName ? (
                <input
                  ref={nameInputRef}
                  autoFocus
                  defaultValue={circuit.name}
                  onBlur={(e) => {
                    const val = e.target.value.trim() || "Circuit";
                    onUpdate({ ...circuit, name: val });
                    setRenamingName(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setRenamingName(false);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-base font-medium text-primary bg-transparent border-b border-primary/40 outline-none w-32 min-w-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingName(true);
                  }}
                  className="block text-base font-medium text-primary hover:text-primary/70 text-left break-words"
                >
                  {circuit.name}
                </button>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(true);
              }}
              aria-label="Circuit options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>

          <div
            ref={setBodyDroppableRef}
            className={`px-3 pb-3 flex flex-col gap-2 rounded-b-xl transition-colors ${
              isBodyOver ? "bg-primary/5" : ""
            }`}
          >
            <SortableContext
              items={circuit.exercises.map((eg) => eg.groupKey)}
              strategy={verticalListSortingStrategy}
            >
              {circuit.exercises.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">No exercises yet</p>
              )}
              {circuit.exercises.map((eg, i) => (
                <CircuitExerciseRow
                  key={eg.groupKey}
                  exGroup={eg}
                  workoutId={workoutId}
                  onClick={() => openSetTray(i)}
                  onRemove={() => removeExercise(i)}
                  onEdit={() => onEditExercise(eg.exercise)}
                />
              ))}
            </SortableContext>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAddExercise();
              }}
              className="self-center mt-1"
            >
              <Plus className="h-4 w-4" /> Add exercise
            </Button>
          </div>
        </Card>
      </div>

      {activeTray && (
        <SetTray
          exercise={circuit.exercises[activeTray.exIdx].exercise}
          draft={activeTray.draft}
          isNew={
            circuit.exercises[activeTray.exIdx].sets.length === 0 ||
            !circuit.exercises[activeTray.exIdx].sets[0]?.id
          }
          onConfirm={confirmSetTray}
          onClose={() => setActiveTray(null)}
        />
      )}

      {menuOpen && (
        <CircuitMenu
          onRemove={() => {
            setMenuOpen(false);
            onRemove();
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function CircuitExerciseRow({
  exGroup,
  workoutId,
  onClick,
  onRemove,
  onEdit,
}: {
  exGroup: ExerciseGroup;
  workoutId: string;
  onClick: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: exGroup.groupKey,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const set = exGroup.sets[0];
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

  return (
    <>
      <div
        ref={setNodeRef}
        style={dragStyle}
        {...attributes}
        {...listeners}
        className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50"
      >
        <button type="button" onClick={onClick} className="flex-1 text-left min-w-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{exGroup.exercise.name}</span>
            <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
              <ExerciseMetaTags e={exGroup.exercise} />
            </span>
            {hasData && (
              <p className="text-sm mt-3 pl-3 before:content-['•'] before:mr-2 before:text-muted-foreground">
                {formatCircuitSetSummary(set, exGroup)}
              </p>
            )}
          </div>
        </button>
        <div className="flex flex-col items-center shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Options for ${exGroup.exercise.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-label={historyOpen ? "Hide history" : "Show history"}
            className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="border-t border-border mx-1">
          <ExerciseHistoryList
            exerciseId={exGroup.exerciseId}
            exercise={exGroup.exercise}
            excludeWorkoutId={workoutId}
          />
        </div>
      )}

      {menuOpen && (
        <CircuitExerciseMenu
          onViewStats={() => {
            setMenuOpen(false);
            navigate(`/exercises/${exGroup.exerciseId}?from=/log/${workoutId}`);
          }}
          onEdit={() => {
            setMenuOpen(false);
            onEdit();
          }}
          onRemove={() => {
            setMenuOpen(false);
            onRemove();
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function formatCircuitSetSummary(set: DraftSet, eg: ExerciseGroup): string {
  const ex = eg.exercise;
  const parts: string[] = [];
  if (!ex.isBodyweight && set.weightKg != null) parts.push(`${set.weightKg} kg`);
  if (ex.trackReps && set.reps != null)
    parts.push(`${set.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && set.durationSec != null) {
    const unit = (ex.timeUnit ?? "min") as "h" | "min" | "sec";
    if (unit === "sec") parts.push(`${set.durationSec}s`);
    else if (unit === "min")
      parts.push(`${Math.round((set.durationSec / 60) * 10) / 10} min`);
    else parts.push(`${Math.round((set.durationSec / 3600) * 100) / 100} h`);
  }
  if (ex.trackResistance && set.resistance != null) parts.push(`res ${set.resistance}`);
  if (ex.trackIncline && set.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${set.inclinePct} incline` : `${set.inclinePct}%`
    );
  }
  return parts.join(" · ") || "—";
}

function CircuitExerciseMenu({
  onViewStats,
  onEdit,
  onRemove,
  onClose,
}: {
  onViewStats: () => void;
  onEdit: () => void;
  onRemove: () => void;
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
            onClick={onViewStats}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            See stats
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Edit exercise
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete entry
          </button>
        </div>
      </div>
    </>
  );
}

function CircuitMenu({
  onRemove,
  onClose,
}: {
  onRemove: () => void;
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
            onClick={onRemove}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete circuit
          </button>
        </div>
      </div>
    </>
  );
}

import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Minus, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import { PBBadges } from "@/components/pb-badge";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { circuitBodyId, isBlankSet, type DraftSet, type ExerciseGroup, type CircuitGroup } from "./workout-editor-types";
import { SetTray } from "./set-rows";
import { useTimer } from "@/components/providers/timer-provider";
import { getExerciseHistory, getLastSessionSetsForExercise } from "@/lib/db/queries";
import { computePBsInOrder, type PBType } from "@/lib/stats/set-pbs";
import { formatDuration, mToHeight, type HeightUnit } from "@/lib/set-format";
import { VariationControl } from "./variation-control";

interface Props {
  circuit: CircuitGroup;
  workoutId: string;
  onUpdate: (next: CircuitGroup) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddExercise: () => void;
  onEditExercise: (exercise: Exercise) => void;
  // See SetRows: "template" mode drops history-driven prefill/PBs/history list.
  mode?: "workout" | "template";
  // Show greyed "ghost" sets on this circuit's exercises. Only true for the
  // active entry of the most recent session.
  showGhost?: boolean;
}

export function CircuitRows({
  circuit,
  workoutId,
  onUpdate,
  onRemove,
  onDuplicate,
  onAddExercise,
  onEditExercise,
  mode = "workout",
  showGhost = false,
}: Props) {
  const isTemplate = mode === "template";
  const timer = useTimer();
  const [activeTray, setActiveTray] = useState<
    { exIdx: number; draft: DraftSet; suggestion: DraftSet | null } | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Cache of the previous session's first set per exerciseId, populated as
  // exercises are discovered. Drives the greyed "ghost" suggestion shown for a
  // circuit exercise that hasn't been logged yet (tap to harden) and the
  // suggestion placeholders when the tray is opened for manual entry. Held in a
  // ref (fetch-dedupe by key); `cacheVersion` re-renders once values land.
  const lastByExerciseRef = useRef<Map<string, DraftSet>>(new Map());
  const [, bumpCache] = useState(0);

  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    // Fetch the first set of the last session that logged each exercise (even
    // if that session wasn't a circuit) for any exercise not yet cached.
    const toFetch = circuit.exercises.filter(
      (eg) => !lastByExerciseRef.current.has(eg.exerciseId)
    );
    if (toFetch.length === 0) return;

    Promise.all(
      toFetch.map((eg) =>
        getLastSessionSetsForExercise(eg.exerciseId, workoutId)
          .then((rows) => ({ exerciseId: eg.exerciseId, set: rows[0] ?? null }))
          .catch((err) => {
            console.error("[circuit-rows] failed to load last set:", err);
            return { exerciseId: eg.exerciseId, set: null };
          })
      )
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) {
        if (!r.set) {
          lastByExerciseRef.current.set(r.exerciseId, makeEmptyDraft(r.exerciseId));
          continue;
        }
        lastByExerciseRef.current.set(r.exerciseId, {
          exerciseId: r.exerciseId,
          reps: r.set.reps,
          weightKg: r.set.weightKg,
          distanceKm: r.set.distanceKm,
          durationSec: r.set.durationSec,
          resistance: r.set.resistance,
          speedMs: r.set.speedMs,
          inclinePct: r.set.inclinePct,
          restSec: r.set.restSec,
          calories: r.set.calories,
          rpe: r.set.rpe,
          steps: r.set.steps,
          heightM: r.set.heightM,
        });
      }
      bumpCache((n) => n + 1);
    });

    return () => {
      cancelled = true;
    };
    // Re-run when the list of exerciseIds changes (e.g., an exercise is added).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit.exercises.map((e) => e.exerciseId).join("|"), workoutId]);

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
    const draft: DraftSet = existing ? { ...existing } : makeEmptyDraft(eg.exerciseId);
    const cached = lastByExerciseRef.current.get(eg.exerciseId) ?? null;
    // Only suggest when there's nothing in the draft yet — otherwise the tray
    // is editing an in-progress set.
    setActiveTray({ exIdx, draft, suggestion: isBlankSet(draft) ? cached : null });
  }

  // One-tap harden of the greyed ghost: copy the previous session's set into
  // this circuit exercise's single set.
  function hardenSet(exIdx: number) {
    const eg = circuit.exercises[exIdx];
    const cached = lastByExerciseRef.current.get(eg.exerciseId);
    if (!cached || isBlankSet(cached)) return;
    const nextExercises = circuit.exercises.map((e, i) =>
      i === exIdx ? { ...e, sets: [{ ...cached, id: undefined }] } : e
    );
    onUpdate({ ...circuit, exercises: nextExercises });
    if (!isTemplate && eg.exercise.trackRest && cached.restSec != null) {
      timer.startRest(cached.restSec);
    }
  }

  function confirmSetTray(draft: DraftSet) {
    if (!activeTray) return;
    const eg = circuit.exercises[activeTray.exIdx];
    const nextExercises = circuit.exercises.map((e, i) =>
      i === activeTray.exIdx ? { ...e, sets: [{ ...e.sets[0], ...draft }] } : e
    );
    onUpdate({ ...circuit, exercises: nextExercises });
    if (!isTemplate && eg.exercise.trackRest && draft.restSec != null) {
      timer.startRest(draft.restSec);
    }
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

  function duplicateExercise(exIdx: number) {
    const eg = circuit.exercises[exIdx];
    const copy: ExerciseGroup = {
      ...eg,
      groupKey: crypto.randomUUID(),
      sets: eg.sets.map((s) => ({ ...s, id: undefined })),
    };
    const next = [
      ...circuit.exercises.slice(0, exIdx + 1),
      copy,
      ...circuit.exercises.slice(exIdx + 1),
    ];
    onUpdate({ ...circuit, exercises: next });
  }

  function setExerciseVariation(exIdx: number, variation: string | null) {
    const nextExercises = circuit.exercises.map((eg, i) =>
      i === exIdx ? { ...eg, variation } : eg
    );
    onUpdate({ ...circuit, exercises: nextExercises });
  }

  return (
    <>
      <div ref={setNodeRef} style={dragStyle}>
        <Card className="border-dashed border-muted-foreground/30">
          <div className="flex items-center gap-3 px-3 pt-3 pb-2">
            <div className="flex-1 min-w-0">
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
            <div className="flex items-center gap-2 shrink-0">
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
            <div className="flex items-center gap-0 shrink-0">
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
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                style={{ touchAction: "none" }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground cursor-grab touch-none"
                aria-label="Drag to reorder circuit"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>
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
                  mode={mode}
                  ghostEnabled={showGhost}
                  suggestion={lastByExerciseRef.current.get(eg.exerciseId) ?? null}
                  onClick={() => openSetTray(i)}
                  onHarden={() => hardenSet(i)}
                  onRemove={() => removeExercise(i)}
                  onDuplicate={() => duplicateExercise(i)}
                  onEdit={() => onEditExercise(eg.exercise)}
                  onChangeVariation={(v) => setExerciseVariation(i, v)}
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
          suggestion={activeTray.suggestion}
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
          onDuplicate={() => {
            setMenuOpen(false);
            onDuplicate();
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

function CircuitExerciseRow({
  exGroup,
  workoutId,
  mode = "workout",
  ghostEnabled,
  suggestion,
  onClick,
  onHarden,
  onRemove,
  onDuplicate,
  onEdit,
  onChangeVariation,
}: {
  exGroup: ExerciseGroup;
  workoutId: string;
  mode?: "workout" | "template";
  ghostEnabled: boolean;
  suggestion: DraftSet | null;
  onClick: () => void;
  onHarden: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onChangeVariation: (variation: string | null) => void;
}) {
  const navigate = useNavigate();
  const isTemplate = mode === "template";
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Prior sets for this exercise (excluding the current workout) so we can flag
  // PBs hit by the set being logged here — same logic as the non-circuit rows.
  const [priorSetsAsc, setPriorSetsAsc] = useState<WorkoutSet[] | null>(null);
  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    getExerciseHistory(exGroup.exerciseId, workoutId)
      .then((entries) => {
        if (cancelled) return;
        // Entries are newest-first; flatten chronologically (oldest → newest).
        const flat: WorkoutSet[] = [];
        for (let i = entries.length - 1; i >= 0; i--) {
          for (const s of entries[i].sets) flat.push(s);
        }
        setPriorSetsAsc(flat);
      })
      .catch((err) => {
        console.error("[circuit-rows] failed to load PB history:", err);
        setPriorSetsAsc([]);
      });
    return () => {
      cancelled = true;
    };
  }, [exGroup.exerciseId, workoutId]);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: exGroup.groupKey,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const set = exGroup.sets[0];

  const pbs = useMemo<PBType[]>(() => {
    if (priorSetsAsc === null || !set) return [];
    const combined = [...priorSetsAsc, set];
    const all = computePBsInOrder(combined, exGroup.exercise);
    return all[all.length - 1] ?? [];
  }, [priorSetsAsc, set, exGroup.exercise]);
  const hasData = !!set && !isBlankSet(set);
  // Before anything is logged, show the previous session's set as a greyed
  // ghost the user taps to harden. None in templates or without history.
  const showGhost =
    ghostEnabled && !isTemplate && !hasData && !!suggestion && !isBlankSet(suggestion);

  return (
    <>
      <div
        ref={setNodeRef}
        style={dragStyle}
        className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50"
      >
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClick}
              className="text-left text-sm font-medium min-w-0"
            >
              {exGroup.exercise.name}
            </button>
            <VariationControl group={exGroup} onChange={onChangeVariation} />
          </div>
          <button
            type="button"
            onClick={onClick}
            className="text-left min-w-0 flex flex-col gap-0.5"
          >
            <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
              <ExerciseMetaTags e={exGroup.exercise} />
            </span>
            {hasData && (
              <p className="text-sm mt-3 pl-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 before:content-['•'] before:mr-2 before:text-muted-foreground">
                <span>{formatCircuitSetSummary(set, exGroup)}</span>
                <PBBadges types={pbs} />
              </p>
            )}
          </button>
          {showGhost && suggestion && (
            <button
              type="button"
              onClick={onHarden}
              aria-label={`Log ${exGroup.exercise.name} (repeat previous)`}
              className="text-left text-sm mt-3 pl-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 opacity-45 hover:opacity-70 transition-opacity before:content-['•'] before:mr-2 before:text-muted-foreground"
            >
              <span>{formatCircuitSetSummary(suggestion, exGroup)}</span>
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
          <div className="flex items-center">
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
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              style={{ touchAction: "none" }}
              className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground cursor-grab touch-none hover:bg-muted hover:text-foreground"
              aria-label={`Drag to reorder ${exGroup.exercise.name}`}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
          {!isTemplate && (
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              aria-label={historyOpen ? "Hide history" : "Show history"}
              className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {historyOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {!isTemplate && historyOpen && (
        <div className="border-t border-border mx-1">
          <ExerciseHistoryList
            exerciseId={exGroup.exerciseId}
            exercise={exGroup.exercise}
            excludeWorkoutId={workoutId}
            futureSets={exGroup.sets}
          />
        </div>
      )}

      {menuOpen && (
        <CircuitExerciseMenu
          onViewStats={() => {
            setMenuOpen(false);
            navigate(
              `/exercises/${exGroup.exerciseId}?from=${isTemplate ? "/templates" : "/log"}/${workoutId}`
            );
          }}
          onEdit={() => {
            setMenuOpen(false);
            onEdit();
          }}
          onDuplicate={() => {
            setMenuOpen(false);
            onDuplicate();
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
  if (ex.trackTime && set.durationSec != null) parts.push(formatDuration(set.durationSec));
  if (ex.trackResistance && set.resistance != null) parts.push(`res ${set.resistance}`);
  if (ex.trackIncline && set.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${set.inclinePct} incline` : `${set.inclinePct}%`
    );
  }
  if (ex.heightUnit && set.heightM != null) {
    const unit = ex.heightUnit as HeightUnit;
    parts.push(`${mToHeight(set.heightM, unit)} ${unit}`);
  }
  if (ex.trackSteps && set.steps != null) parts.push(`${set.steps} steps`);
  if (ex.trackRpe && set.rpe != null) parts.push(`RPE ${set.rpe}`);
  return parts.join(" · ") || "—";
}

function CircuitExerciseMenu({
  onViewStats,
  onEdit,
  onDuplicate,
  onRemove,
  onClose,
}: {
  onViewStats: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
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
            onClick={onDuplicate}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Duplicate exercise
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
  onDuplicate,
  onRemove,
  onClose,
}: {
  onDuplicate: () => void;
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
            onClick={onDuplicate}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Duplicate circuit
          </button>
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

function makeEmptyDraft(exerciseId: string): DraftSet {
  return {
    exerciseId,
    reps: null,
    weightKg: null,
    distanceKm: null,
    durationSec: null,
    resistance: null,
    speedMs: null,
    inclinePct: null,
    restSec: null,
    calories: null,
    rpe: null,
    steps: null,
    heightM: null,
  };
}

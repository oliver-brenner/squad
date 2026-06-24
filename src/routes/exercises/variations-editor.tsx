import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ExerciseVariation } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Per-exercise variation list editor used inside the exercise form. Mirrors the
// look of the Customise-fields list (grip reorder, inline rename, delete, add
// box) but operates purely on local state — changes persist when the form
// saves. The `key` of an entry is a stable slug; renaming only touches `label`
// so any past sets referencing the key keep resolving.
export function VariationsEditor({
  value,
  onChange,
}: {
  value: ExerciseVariation[];
  onChange: (next: ExerciseVariation[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = value.findIndex((v) => v.key === active.id);
    const newIndex = value.findIndex((v) => v.key === over.id);
    onChange(arrayMove(value, oldIndex, newIndex));
  }

  function handleRename(key: string, label: string) {
    onChange(value.map((v) => (v.key === key ? { ...v, label } : v)));
  }

  function handleDelete(key: string) {
    onChange(value.filter((v) => v.key !== key));
  }

  function handleAdd(label: string) {
    setAdding(false);
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = uniqueKey(slugify(trimmed), new Set(value.map((v) => v.key)));
    onChange([...value, { key, label: trimmed }]);
  }

  // Empty + not adding: hug the lone "Add variation" button with tighter
  // padding so the box doesn't tower over a single control.
  const compact = value.length === 0 && !adding;

  return (
    <Card className={compact ? "p-1" : "p-2"}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={value.map((v) => v.key)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col">
            {value.map((v) => (
              <SortableRow
                key={v.key}
                item={v}
                onRename={(label) => handleRename(v.key, label)}
                onDelete={() => handleDelete(v.key)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {adding ? (
        <AddRow onConfirm={handleAdd} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground ${
            value.length > 0 ? "mt-1" : ""
          }`}
        >
          <Plus className="h-4 w-4" />
          Add variation
        </button>
      )}
    </Card>
  );
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueKey(base: string, used: Set<string>): string {
  const b = base || "variation";
  if (!used.has(b)) return b;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${b} ${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${b} ${used.size + 1}`;
}

function SortableRow({
  item,
  onRename,
  onDelete,
}: {
  item: ExerciseVariation;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-1 py-0.5">
      <button
        type="button"
        className="flex h-9 w-7 cursor-grab touch-none items-center justify-center text-muted-foreground"
        aria-label="Reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <InlineLabel value={item.label} onChange={onRename} />
      <button
        type="button"
        onClick={onDelete}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Delete ${item.label}`}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function InlineLabel({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="flex-1 truncate rounded-md px-2 py-2 text-left text-sm hover:bg-muted/50"
      >
        {value}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="flex-1 h-9"
    />
  );
}

function AddRow({
  onConfirm,
  onCancel,
}: {
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="mt-1 flex items-center gap-2 p-1">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Name"
        className="h-9"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm(draft);
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <Button size="sm" onClick={() => onConfirm(draft)}>
        Add
      </Button>
      <Button size="sm" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

import { useState, useTransition, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  GripVertical,
} from "lucide-react";
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
import type { FieldOption, MuscleGroupNode } from "@/lib/user-field-options";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import {
  addFieldOption,
  renameFieldOption,
  reorderFieldOptions,
  deleteFieldOption,
} from "@/lib/mutations/user-field-options";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function FieldsEditor() {
  const initial = useUserFieldOptions();
  const [categories, setCategories] = useState<FieldOption[]>(initial.categories);
  const [equipment, setEquipment] = useState<FieldOption[]>(initial.equipment);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroupNode[]>(initial.muscleGroups);

  useEffect(() => {
    setCategories(initial.categories);
  }, [initial.categories]);
  useEffect(() => {
    setEquipment(initial.equipment);
  }, [initial.equipment]);
  useEffect(() => {
    setMuscleGroups(initial.muscleGroups);
  }, [initial.muscleGroups]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2 py-2">
        <Link
          to="/settings"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Customise fields</h1>
      </header>

      <p className="text-sm text-muted-foreground">
        Add, rename, reorder, or remove the options shown when editing exercises and filtering
        your library.
      </p>

      <FlatSection title="Categories" kind="category" items={categories} onChange={setCategories} />
      <FlatSection title="Equipment" kind="equipment" items={equipment} onChange={setEquipment} />
      <MuscleSection groups={muscleGroups} onChange={setMuscleGroups} />
    </div>
  );
}

function FlatSection({
  title,
  kind,
  items,
  onChange,
}: {
  title: string;
  kind: "category" | "equipment";
  items: FieldOption[];
  onChange: (next: FieldOption[]) => void;
}) {
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, oldIndex, newIndex);
    onChange(next);
    startTransition(async () => {
      await reorderFieldOptions({ kind, ids: next.map((i) => i.id) });
    });
  }

  function handleRename(id: string, label: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, label } : i)));
    startTransition(async () => {
      await renameFieldOption({ id, label });
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this option? It will be unassigned from any exercises that use it."))
      return;
    onChange(items.filter((i) => i.id !== id));
    startTransition(async () => {
      await deleteFieldOption({ id });
    });
  }

  function handleAdd(label: string) {
    setAdding(false);
    if (!label.trim()) return;
    startTransition(async () => {
      await addFieldOption({ kind, label });
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <Card className="p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col">
              {items.map((item) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  onRename={(label) => handleRename(item.id, label)}
                  onDelete={() => handleDelete(item.id)}
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
            className="mt-1 flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Add {title.toLowerCase().replace(/ies$/, "y").replace(/s$/, "")}
          </button>
        )}
      </Card>
    </section>
  );
}

function MuscleSection({
  groups,
  onChange,
}: {
  groups: MuscleGroupNode[];
  onChange: (next: MuscleGroupNode[]) => void;
}) {
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((i) => i.id === active.id);
    const newIndex = groups.findIndex((i) => i.id === over.id);
    const next = arrayMove(groups, oldIndex, newIndex);
    onChange(next);
    startTransition(async () => {
      await reorderFieldOptions({
        kind: "muscle_group",
        ids: next.map((i) => i.id),
      });
    });
  }

  function handleGroupRename(id: string, label: string) {
    onChange(groups.map((g) => (g.id === id ? { ...g, label } : g)));
    startTransition(async () => {
      await renameFieldOption({ id, label });
    });
  }

  function handleGroupDelete(id: string) {
    if (
      !confirm(
        "Delete this muscle group and all its children? They will be unassigned from any exercises."
      )
    )
      return;
    onChange(groups.filter((g) => g.id !== id));
    startTransition(async () => {
      await deleteFieldOption({ id });
    });
  }

  function handleGroupAdd(label: string) {
    setAdding(false);
    if (!label.trim()) return;
    startTransition(async () => {
      await addFieldOption({ kind: "muscle_group", label });
    });
  }

  function handleChildReorder(groupId: string, ids: string[]) {
    onChange(
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              children: ids
                .map((id) => g.children.find((c) => c.id === id)!)
                .filter(Boolean),
            }
          : g
      )
    );
    startTransition(async () => {
      await reorderFieldOptions({ kind: "muscle_child", parentId: groupId, ids });
    });
  }

  function handleChildRename(groupId: string, childId: string, label: string) {
    onChange(
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              children: g.children.map((c) => (c.id === childId ? { ...c, label } : c)),
            }
          : g
      )
    );
    startTransition(async () => {
      await renameFieldOption({ id: childId, label });
    });
  }

  function handleChildDelete(groupId: string, childId: string) {
    if (!confirm("Delete this muscle? It will be unassigned from any exercises that use it."))
      return;
    onChange(
      groups.map((g) =>
        g.id === groupId
          ? { ...g, children: g.children.filter((c) => c.id !== childId) }
          : g
      )
    );
    startTransition(async () => {
      await deleteFieldOption({ id: childId });
    });
  }

  function handleChildAdd(groupId: string, label: string) {
    if (!label.trim()) return;
    startTransition(async () => {
      await addFieldOption({ kind: "muscle_child", parentId: groupId, label });
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Muscles
      </h2>
      <Card className="p-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleGroupDragEnd}
        >
          <SortableContext
            items={groups.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col">
              {groups.map((g) => (
                <MuscleGroupRow
                  key={g.id}
                  group={g}
                  expanded={expanded.has(g.id)}
                  onToggle={() => toggleExpanded(g.id)}
                  onRename={(label) => handleGroupRename(g.id, label)}
                  onDelete={() => handleGroupDelete(g.id)}
                  onChildReorder={(ids) => handleChildReorder(g.id, ids)}
                  onChildRename={(childId, label) => handleChildRename(g.id, childId, label)}
                  onChildDelete={(childId) => handleChildDelete(g.id, childId)}
                  onChildAdd={(label) => handleChildAdd(g.id, label)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {adding ? (
          <AddRow onConfirm={handleGroupAdd} onCancel={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Add muscle group
          </button>
        )}
      </Card>
    </section>
  );
}

function SortableRow({
  item,
  onRename,
  onDelete,
}: {
  item: FieldOption;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
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

function MuscleGroupRow({
  group,
  expanded,
  onToggle,
  onRename,
  onDelete,
  onChildReorder,
  onChildRename,
  onChildDelete,
  onChildAdd,
}: {
  group: MuscleGroupNode;
  expanded: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onChildReorder: (ids: string[]) => void;
  onChildRename: (childId: string, label: string) => void;
  onChildDelete: (childId: string) => void;
  onChildAdd: (label: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const [adding, setAdding] = useState(false);

  function handleChildDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = group.children.findIndex((c) => c.id === active.id);
    const newIndex = group.children.findIndex((c) => c.id === over.id);
    onChildReorder(arrayMove(group.children, oldIndex, newIndex).map((c) => c.id));
  }

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div className="flex items-center gap-1 py-0.5">
        <button
          type="button"
          className="flex h-9 w-7 cursor-grab touch-none items-center justify-center text-muted-foreground"
          aria-label="Reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-9 w-7 items-center justify-center text-muted-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <InlineLabel value={group.label} onChange={onRename} />
        <button
          type="button"
          onClick={onDelete}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Delete ${group.label}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {expanded && (
        <div className="ml-9 flex flex-col border-l border-border/50 pl-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleChildDragEnd}
          >
            <SortableContext
              items={group.children.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col">
                {group.children.map((c) => (
                  <SortableRow
                    key={c.id}
                    item={c}
                    onRename={(label) => onChildRename(c.id, label)}
                    onDelete={() => onChildDelete(c.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {adding ? (
            <AddRow
              onConfirm={(label) => {
                setAdding(false);
                onChildAdd(label);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              Add muscle
            </button>
          )}
        </div>
      )}
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

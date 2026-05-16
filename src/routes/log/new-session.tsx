import { useEffect, useState, useTransition, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { getDaysInMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkout, copyWorkout } from "@/lib/mutations/workouts";
import { getRecentWorkouts, getWorkoutWithSets } from "@/lib/db/queries";
import type { SessionType } from "@/lib/db/schema";

const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: "workout", label: "Workout" },
  { value: "stretch", label: "Stretch" },
  { value: "sport", label: "Sport" },
  { value: "lifestyle", label: "Other" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ITEM_H = 44;
const today = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => today.getFullYear() - 2 + i);

export function NewSession() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copyFrom = searchParams.get("copyFrom") ?? undefined;

  const [name, setName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [sessionType, setSessionType] = useState<SessionType>("workout");

  const [day, setDay] = useState(today.getDate());
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  const daysInMonth = getDaysInMonth(new Date(year, month));

  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [month, year, daysInMonth, day]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (copyFrom) {
          const source = await getWorkoutWithSets(copyFrom);
          if (!cancelled) setName(source?.workout.name ?? "");
        } else {
          const recent = await getRecentWorkouts(1);
          if (!cancelled) setName(recent[0]?.name ?? "");
        }
      } catch (err) {
        console.error("[new-session] failed to load default name:", err);
        // Don't block the user — they can still create a session, just without
        // a prefilled name.
      } finally {
        if (!cancelled) setNameLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copyFrom]);

  function submit() {
    if (!name.trim()) return;
    const performedOn = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    startTransition(async () => {
      const id = copyFrom
        ? await copyWorkout({
            sourceId: copyFrom,
            name: name.trim(),
            performedOn,
            sessionType,
          })
        : await createWorkout({ name: name.trim(), performedOn, sessionType });
      navigate(`/log/${id}`);
    });
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  return (
    <div className="flex flex-col gap-6 pt-4">
      <header className="flex items-center gap-2 py-4">
        <Link
          to="/log"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {copyFrom ? "Copy session" : "New session"}
        </h1>
      </header>

      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={nameLoaded ? "Name your session..." : "Loading…"}
        disabled={!nameLoaded}
        className="text-base"
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) submit();
        }}
      />

      <div className="relative rounded-2xl border border-border overflow-hidden select-none">
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none z-10 bg-gradient-to-b from-background to-transparent"
          style={{ height: ITEM_H * 2 }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none z-10 bg-gradient-to-t from-background to-transparent"
          style={{ height: ITEM_H * 2 }}
        />
        <div
          className="absolute left-0 right-0 border-t border-border pointer-events-none z-10"
          style={{ top: ITEM_H * 2 }}
        />
        <div
          className="absolute left-0 right-0 border-b border-border pointer-events-none z-10"
          style={{ top: ITEM_H * 3 }}
        />

        <div className="flex">
          <WheelColumn items={days} selectedIndex={day - 1} onSelect={(i) => setDay(i + 1)} />
          <WheelColumn items={MONTHS} selectedIndex={month} onSelect={setMonth} />
          <WheelColumn
            items={YEARS.map(String)}
            selectedIndex={YEARS.indexOf(year)}
            onSelect={(i) => setYear(YEARS[i])}
          />
        </div>
      </div>

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

      <Button
        size="lg"
        disabled={!name.trim() || isPending}
        onClick={submit}
        className="w-full"
      >
        {isPending ? (copyFrom ? "Copying..." : "Creating...") : "Go"}
      </Button>
    </div>
  );
}

function WheelColumn({
  items,
  selectedIndex,
  onSelect,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const [dragOffset, setDragOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const dragStartY = useRef(0);
  const dragging = useRef(false);

  const baseY = (2 - selectedIndex) * ITEM_H;
  const y = baseY + dragOffset;
  const visualIndex = Math.max(0, Math.min(Math.round(2 - y / ITEM_H), items.length - 1));

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    dragStartY.current = e.clientY;
    setAnimating(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    setDragOffset(e.clientY - dragStartY.current);
  }

  function commit(clientY: number) {
    if (!dragging.current) return;
    dragging.current = false;
    const delta = -Math.round((clientY - dragStartY.current) / ITEM_H);
    const newIdx = Math.max(0, Math.min(selectedIndex + delta, items.length - 1));
    setAnimating(true);
    setDragOffset(0);
    onSelect(newIdx);
  }

  return (
    <div
      className="flex-1 overflow-hidden"
      style={{ height: ITEM_H * 5, touchAction: "none", cursor: "ns-resize" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => commit(e.clientY)}
      onPointerCancel={(e) => commit(e.clientY)}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          transition: animating ? "transform 150ms ease-out" : "none",
          willChange: "transform",
        }}
        onTransitionEnd={() => setAnimating(false)}
      >
        {items.map((label, i) => (
          <div
            key={label}
            style={{ height: ITEM_H }}
            className={`flex items-center justify-center select-none ${
              i === visualIndex
                ? "text-foreground font-medium text-sm"
                : "text-muted-foreground/60 text-sm"
            }`}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

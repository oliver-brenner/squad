import { useEffect, useState, useTransition, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { getDaysInMonth, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateWorkoutDetails, updateSessionGuests } from "@/lib/mutations/workouts";
import { getWorkoutWithSets, getSessionGuests } from "@/lib/db/queries";
import type { SessionType } from "@/lib/db/schema";
import type { DraftGuest } from "@/components/guest-picker-sheet";
import { GuestEditor, draftGuestsToInput } from "@/components/guest-editor";

const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: "workout", label: "Workout" },
  { value: "stretch", label: "Stretch" },
  { value: "sport", label: "Sport" },
  { value: "lifestyle", label: "Other" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ITEM_H = 44;
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => thisYear - 2 + i);

export function EditSession() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/log";

  const [loaded, setLoaded] = useState<{ initial: boolean; notFound: boolean }>({
    initial: false,
    notFound: false,
  });
  const [name, setName] = useState("");
  const [sessionType, setSessionType] = useState<SessionType>("workout");
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(thisYear);
  const [guests, setGuests] = useState<DraftGuest[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getWorkoutWithSets(id);
        if (cancelled) return;
        if (!data) {
          setLoaded({ initial: true, notFound: true });
          return;
        }
        const date = parseISO(data.workout.performedOn);
        setName(data.workout.name);
        setSessionType((data.workout.sessionType ?? "workout") as SessionType);
        setDay(date.getDate());
        setMonth(date.getMonth());
        setYear(date.getFullYear());
        const resolved = await getSessionGuests(id);
        if (cancelled) return;
        setGuests(
          resolved.map((g) =>
            g.guestProfileId
              ? { kind: "user", profileId: g.guestProfileId, name: g.name, avatarUrl: g.avatarUrl }
              : { kind: "guest", tempId: g.id, name: g.name }
          )
        );
        setLoaded({ initial: true, notFound: false });
      } catch (err) {
        if (cancelled) return;
        console.error("[edit-session] failed to load:", err);
        // Treat fetch failure as not-found so we redirect to /log instead of
        // spinning forever.
        setLoaded({ initial: true, notFound: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const daysInMonth = getDaysInMonth(new Date(year, month));

  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [month, year, daysInMonth, day]);

  if (loaded.notFound) return <Navigate to="/log" replace />;
  if (!loaded.initial) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  function submit() {
    if (!id || !name.trim()) return;
    const performedOn = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    startTransition(async () => {
      await updateWorkoutDetails({ id, name: name.trim(), performedOn, sessionType });
      await updateSessionGuests({ workoutId: id, guests: draftGuestsToInput(guests) });
      navigate(returnTo);
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
        <h1 className="truncate text-xl font-semibold tracking-tight">Edit session</h1>
      </header>

      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name your session..."
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

      <GuestEditor guests={guests} onChange={setGuests} />

      <Button
        size="lg"
        disabled={!name.trim() || isPending}
        onClick={submit}
        className="w-full"
      >
        {isPending ? "Saving..." : "Save"}
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

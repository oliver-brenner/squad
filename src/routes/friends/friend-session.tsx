import { useEffect, useState, useTransition } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import {
  getExerciseById,
  getExerciseSetsForUser,
  getFriendSessionDetail,
} from "@/lib/db/queries";
import type { Exercise, Profile, Workout, WorkoutSet } from "@/lib/db/types";
import { sessionTypeColor } from "@/lib/session-type-color";
import { copyExerciseFromFriend } from "@/lib/mutations/exercises";
import { copyFriendSession } from "@/lib/mutations/workouts";
import {
  buildReadOnlyItems,
  SessionReadOnlyItems,
  type PBMap,
  type ReadOnlyItem,
} from "@/components/session-readonly";
import { SessionGuests } from "@/components/session-guests";
import { computePBsInOrder } from "@/lib/stats/set-pbs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only accept in-app relative paths as the back target. Rejects anything that
// could escape the SPA (protocol-relative `//evil.com`, full URLs, etc.).
function sanitizeBackHref(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function SessionActionsSheet({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function handleCopy() {
    setError(null);
    startTransition(async () => {
      try {
        const newWorkoutId = await copyFriendSession({ sourceWorkoutId: sessionId });
        onClose();
        // Land the user on their freshly-copied session in the editor — the
        // copy is in their library, and they can start logging or edit
        // immediately. Tangible success feedback.
        navigate(`/log/${newWorkoutId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't copy session");
      }
    });
  }

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
            onClick={handleCopy}
            disabled={pending}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50 disabled:opacity-60"
          >
            {pending ? "Copying…" : "Copy session"}
          </button>
          {error && (
            <p className="text-center text-sm text-red-600 px-2">{error}</p>
          )}
        </div>
      </div>
    </>
  );
}

type LoadState =
  | { state: "loading" }
  | { state: "not-found" }
  | {
      state: "ready";
      workout: Workout;
      sets: WorkoutSet[];
      author: Profile | null;
      items: ReadOnlyItem[];
      pbsBySetId: PBMap;
    };

export function FriendSession() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // `?from=...` lets the caller pick the back target. The profile page passes
  // its own URL so back returns there; the feed omits it, which falls through
  // to the default `/friends` landing.
  const backHref = sanitizeBackHref(searchParams.get("from")) ?? "/friends";
  const [data, setData] = useState<LoadState>({ state: "loading" });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!id || !UUID_RE.test(id)) {
      setData({ state: "not-found" });
      return;
    }
    let cancelled = false;
    (async () => {
      const detail = await getFriendSessionDetail(id);
      if (cancelled) return;
      if (!detail) {
        setData({ state: "not-found" });
        return;
      }
      // Resolve every distinct exercise_id. If a followee's exercises haven't
      // streamed in yet, the renderer falls back to "Unknown exercise".
      const exerciseIds = [
        ...new Set(detail.sets.map((s) => s.exerciseId).filter(Boolean)),
      ];
      const exercises = new Map<string, Exercise>();
      for (const exId of exerciseIds) {
        const ex = await getExerciseById(exId);
        if (ex) exercises.set(exId, ex);
      }
      if (cancelled) return;

      // Compute PB badges using the friend's full history per exercise. The
      // newest-wins post-pass inside computePBsInOrder strips any record that
      // they've since beaten — so a set badged here is still their current PB.
      const pbsBySetId: PBMap = new Map();
      await Promise.all(
        [...exercises.entries()].map(async ([exId, ex]) => {
          const history = await getExerciseSetsForUser(exId, detail.workout.userId);
          const pbs = computePBsInOrder(history, ex);
          history.forEach((s, i) => {
            if (pbs[i].length > 0) pbsBySetId.set(s.id, pbs[i]);
          });
        })
      );
      if (cancelled) return;

      setData({
        state: "ready",
        workout: detail.workout,
        sets: detail.sets,
        author: detail.author,
        items: buildReadOnlyItems(detail.sets, exercises),
        pbsBySetId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (data.state === "not-found") return <Navigate to="/friends" replace />;
  if (data.state === "loading") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  const { workout, author, items, pbsBySetId } = data;
  const authorLabel = author?.username
    ? `@${author.username}`
    : author?.displayName ?? "Unknown user";

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex items-center gap-2 pt-4">
        <Link
          to={backHref}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {workout.name || "Workout"}
          </h1>
          <SessionGuests
            workoutId={workout.id}
            variant="page"
            backHref={location.pathname + location.search}
          />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{authorLabel}</span>
            <span>·</span>
            <span>{format(parseISO(workout.performedOn), "EEE d MMM")}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground -mr-2"
          aria-label="Session options"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      {menuOpen && (
        <SessionActionsSheet
          sessionId={workout.id}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <div className={`h-1.5 rounded-full ${sessionTypeColor(workout.sessionType)}`} />

      <SessionReadOnlyItems
        items={items}
        pbsBySetId={pbsBySetId}
        onCopyExercise={async (exerciseId) => {
          await copyExerciseFromFriend({ sourceExerciseId: exerciseId });
        }}
      />
    </div>
  );
}

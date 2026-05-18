import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { getExerciseById, getFriendSessionDetail } from "@/lib/db/queries";
import type { Exercise, Profile, Workout, WorkoutSet } from "@/lib/db/types";
import { sessionTypeColor } from "@/lib/session-type-color";
import { copyExerciseFromFriend } from "@/lib/mutations/exercises";
import {
  buildReadOnlyItems,
  SessionReadOnlyItems,
  type ReadOnlyItem,
} from "@/components/session-readonly";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only accept in-app relative paths as the back target. Rejects anything that
// could escape the SPA (protocol-relative `//evil.com`, full URLs, etc.).
function sanitizeBackHref(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
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
    };

export function FriendSession() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // `?from=...` lets the caller pick the back target. The profile page passes
  // its own URL so back returns there; the feed omits it, which falls through
  // to the default `/friends` landing.
  const backHref = sanitizeBackHref(searchParams.get("from")) ?? "/friends";
  const [data, setData] = useState<LoadState>({ state: "loading" });

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
      setData({
        state: "ready",
        workout: detail.workout,
        sets: detail.sets,
        author: detail.author,
        items: buildReadOnlyItems(detail.sets, exercises),
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

  const { workout, author, items } = data;
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{authorLabel}</span>
            <span>·</span>
            <span>{format(parseISO(workout.performedOn), "EEE d MMM")}</span>
          </div>
        </div>
      </header>

      <div className={`h-1.5 rounded-full ${sessionTypeColor(workout.sessionType)}`} />

      <SessionReadOnlyItems
        items={items}
        onCopyExercise={async (exerciseId) => {
          await copyExerciseFromFriend({ sourceExerciseId: exerciseId });
        }}
      />
    </div>
  );
}

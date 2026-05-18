import { useEffect, useState, useTransition } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stats/stat-card";
import { decodeProfile } from "@/lib/db/decoders";
import type { FollowRow, ProfileRow } from "@/lib/db/schema";
import {
  getRecentWorkoutsWithExercises,
  getUserProfileStats,
  type UserProfileStats,
  type WorkoutWithExercises,
} from "@/lib/db/queries";
import { followUser, unfollowUser } from "@/lib/mutations/follows";
import { SessionList } from "@/routes/log/session-list";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  if (!id || !UUID_RE.test(id)) return <Navigate to="/friends" replace />;
  return <UserProfileInner userId={id} />;
}

function UserProfileInner({ userId }: { userId: string }) {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const isMe = myId === userId;

  // Reactive: profile + follow status both stream in via PowerSync.
  const { data: profileRows } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [userId]
  );
  const profile = profileRows[0] ? decodeProfile(profileRows[0]) : null;

  const { data: followRows } = useQuery<FollowRow>(
    `SELECT * FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1`,
    [myId, userId]
  );
  const isFollowing = followRows.length > 0;

  // One-shot — matches the Log tab's pattern. Re-loads on remount.
  const [stats, setStats] = useState<UserProfileStats | null>(null);
  const [sessions, setSessions] = useState<WorkoutWithExercises[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, w] = await Promise.all([
        getUserProfileStats(userId),
        getRecentWorkoutsWithExercises(60, userId),
      ]);
      if (!cancelled) {
        setStats(s);
        setSessions(w);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handle = profile?.username
    ? `@${profile.username}`
    : profile?.displayName ?? "Unknown user";
  const initial = (profile?.username ?? profile?.displayName ?? "?")
    .slice(0, 1)
    .toUpperCase();

  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="flex items-center gap-2 pt-4">
        <Link
          to="/friends"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </header>

      <section className="flex flex-col items-center gap-3 text-center">
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-20 w-20 rounded-full"
          />
        ) : (
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center text-2xl font-semibold">
            {initial}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <div className="text-xl font-semibold tracking-tight">{handle}</div>
          {profile?.username && profile?.displayName && (
            <div className="text-sm text-muted-foreground">{profile.displayName}</div>
          )}
        </div>
        {!isMe && (
          <FollowButton userId={userId} isFollowing={isFollowing} />
        )}
      </section>

      <section className="grid grid-cols-3 gap-2">
        <StatCard label="Sessions" value={stats?.totalSessions ?? "—"} />
        <StatCard label="Sets" value={stats?.totalSets ?? "—"} />
        <StatCard label="Reps" value={formatReps(stats?.totalReps)} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sessions
        </h2>
        {sessions === null ? (
          <div className="py-8 flex justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No sessions logged yet.
          </Card>
        ) : (
          <SessionList
            linkHref={(id) =>
              isMe
                ? `/log/${id}`
                : `/friends/sessions/${id}?from=${encodeURIComponent(`/users/${userId}`)}`
            }
            showMenu={isMe}
            sessions={sessions.map((w) => ({
              id: w.id,
              name: w.name,
              dateLabel: format(parseISO(w.performedOn), "EEE d MMM"),
              exerciseNames: w.exerciseNames,
              sessionType: w.sessionType,
              totalExercises: w.totalExercises,
              totalSets: w.totalSets,
              totalReps: w.totalReps,
            }))}
          />
        )}
      </section>
    </div>
  );
}

function FollowButton({
  userId,
  isFollowing,
}: {
  userId: string;
  isFollowing: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      try {
        if (isFollowing) await unfollowUser(userId);
        else await followUser(userId);
      } catch (err) {
        console.error("[user-profile] follow toggle failed:", err);
      }
    });
  }

  return (
    <Button
      onClick={toggle}
      disabled={pending}
      variant={isFollowing ? "outline" : "default"}
      size="lg"
      className="min-w-32"
    >
      {isFollowing ? "Unfollow" : "Follow"}
    </Button>
  );
}

function formatReps(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

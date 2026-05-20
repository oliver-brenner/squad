import { useEffect, useState, useTransition } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, Settings as SettingsIcon } from "lucide-react";
import { useQuery } from "@powersync/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { StatCard } from "@/components/stats/stat-card";
import { ProfileStatsCharts } from "@/components/profile/profile-stats-charts";
import { decodeProfile } from "@/lib/db/decoders";
import type { FollowRow, ProfileRow } from "@/lib/db/schema";
import {
  getRecentWorkoutsWithExercises,
  getUserProfileStats,
  getUserSessionAggregates,
  getUserWorkoutDates,
  type UserProfileStats,
  type UserSessionAggregate,
  type WorkoutWithExercises,
} from "@/lib/db/queries";
import { fetchProfileById } from "@/lib/supabase/profiles";
import { followUser, unfollowUser } from "@/lib/mutations/follows";
import { SessionList } from "@/routes/log/session-list";

type ProfileViewProps = {
  userId: string;
  backHref?: string;
};

export function ProfileView({ userId, backHref }: ProfileViewProps) {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const isMe = myId === userId;

  const { data: profileRows } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [userId]
  );
  const localProfile = profileRows[0] ? decodeProfile(profileRows[0]) : null;

  // Fallback for the no-local-row case: just unfollowed (sync evicted the
  // profile), or viewing a Suggested user you've never followed.
  const { data: remoteProfile } = useReactQuery({
    queryKey: ["profile-fallback", userId],
    queryFn: () => fetchProfileById(userId),
    enabled: !localProfile,
  });

  const profile = localProfile ?? remoteProfile ?? null;

  const { data: followRows } = useQuery<FollowRow>(
    `SELECT * FROM follows WHERE follower_id = ? AND followee_id = ? LIMIT 1`,
    [myId, userId]
  );
  const isFollowing = followRows.length > 0;

  const [stats, setStats] = useState<UserProfileStats | null>(null);
  const [sessions, setSessions] = useState<WorkoutWithExercises[] | null>(null);
  const [sessionAggregates, setSessionAggregates] = useState<UserSessionAggregate[] | null>(null);
  const [workoutDates, setWorkoutDates] = useState<string[] | null>(null);
  const hasLocalData = isMe || isFollowing;

  // Reactive signature so stats/sessions re-fetch when PowerSync streams in
  // new rows after a follow toggle. Without it, the one-shot fetch races the
  // stream and lands on empty results.
  const { data: sigRows = [] } = useQuery<{ sig: string }>(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM workouts WHERE user_id = ?), 0)
       || '|' ||
       COALESCE((SELECT COUNT(*) FROM sets WHERE user_id = ?), 0)
       || '|' ||
       COALESCE((SELECT MAX(updated_at) FROM workouts WHERE user_id = ?), '')
       AS sig`,
    [userId, userId, userId]
  );
  const dataSignature = sigRows[0]?.sig ?? "";

  useEffect(() => {
    if (!hasLocalData) {
      setStats(null);
      setSessions(null);
      setSessionAggregates(null);
      setWorkoutDates(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, w, agg, wd] = await Promise.all([
        getUserProfileStats(userId),
        getRecentWorkoutsWithExercises(60, userId),
        getUserSessionAggregates(userId),
        getUserWorkoutDates(userId),
      ]);
      if (!cancelled) {
        setStats(s);
        setSessions(w);
        setSessionAggregates(agg);
        setWorkoutDates(wd);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, hasLocalData, dataSignature]);

  const usernameLabel = profile?.username ? `@${profile.username}` : null;
  const handle = usernameLabel ?? profile?.displayName ?? "Unknown user";
  const initial = (profile?.username ?? profile?.displayName ?? "?")
    .slice(0, 1)
    .toUpperCase();

  const [tab, setTab] = useState<"log" | "stats">("log");

  return (
    <div className="flex flex-col gap-6 pb-4">
      <section className="flex items-center gap-3 pt-4">
        {backHref && (
          <Link
            to={backHref}
            className="-ml-2 -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        )}
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-xl font-semibold flex-shrink-0">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold tracking-tight break-words">{handle}</div>
          {profile?.username && profile?.displayName && (
            <div className="truncate text-sm text-muted-foreground">{profile.displayName}</div>
          )}
          <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            Joined: {formatJoinedDate(profile?.createdAt)}
          </div>
        </div>
        <div className="flex-shrink-0">
          {isMe ? (
            <Link
              to="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Settings"
            >
              <SettingsIcon className="h-6 w-6" />
            </Link>
          ) : (
            <FollowButton userId={userId} isFollowing={isFollowing} />
          )}
        </div>
      </section>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "log", label: "Log" },
          { value: "stats", label: "Stats" },
        ]}
      />

      {tab === "log" ? (
        <section className="flex flex-col gap-2">
          {!hasLocalData ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Follow {usernameLabel ?? handle} to see their sessions.
            </Card>
          ) : sessions === null ? (
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
      ) : (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            <StatCard compact label="Sessions" value={hasLocalData ? (stats ? withCommas(stats.totalSessions) : "—") : "—"} />
            <StatCard compact label="Sets" value={hasLocalData ? (stats ? withCommas(stats.totalSets) : "—") : "—"} />
            <StatCard compact label="Reps" value={hasLocalData ? formatReps(stats?.totalReps) : "—"} />
            <StatCard compact label="Volume" value={hasLocalData ? formatVolume(stats?.totalVolumeKg) : "—"} />
          </div>
          {hasLocalData && sessionAggregates && workoutDates && (
            <ProfileStatsCharts sessions={sessionAggregates} workoutDates={workoutDates} />
          )}
        </section>
      )}
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
        console.error("[profile-view] follow toggle failed:", err);
      }
    });
  }

  return (
    <Button
      onClick={toggle}
      disabled={pending}
      variant={isFollowing ? "outline" : "default"}
      size="sm"
    >
      {isFollowing ? "Unfollow" : "Follow"}
    </Button>
  );
}

function formatJoinedDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM yyyy");
  } catch {
    return "—";
  }
}

function withCommas(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatReps(n: number | undefined): string {
  if (n == null) return "—";
  return withCommas(n);
}

function formatVolume(n: number | undefined): string {
  if (n == null || n === 0) return "—";
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}kg`;
}

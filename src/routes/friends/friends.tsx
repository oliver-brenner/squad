import { useState, useTransition } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { useQuery } from "@powersync/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useAuth } from "@/lib/auth/auth-context";
import type { FollowRow } from "@/lib/db/schema";
import { fetchDiscoverableProfiles, type PublicProfile } from "@/lib/supabase/profiles";
import { followUser, unfollowUser } from "@/lib/mutations/follows";

type FeedRow = {
  workout_id: string;
  workout_name: string;
  performed_on: string;
  author_id: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
};

type Tab = "feed" | "following";

export function Friends() {
  const [tab, setTab] = useState<Tab>("feed");

  return (
    <>
      <PageHeader title="Squad" />
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "feed", label: "Feed" },
          { value: "following", label: "Following" },
        ]}
      />
      {tab === "feed" ? <FeedView /> : <FollowingView />}
    </>
  );
}

function FeedView() {
  const { user } = useAuth();
  const myId = user?.id ?? "";

  // Reactive: any new followee workout that streams in via PowerSync's
  // followee_workouts bucket appears here without us doing anything. The
  // EXISTS subquery against `follows` keeps the feed scoped to current
  // followees (so unfollowing instantly removes their sessions).
  const { data: rows = [] } = useQuery<FeedRow>(
    `SELECT
       w.id AS workout_id,
       w.name AS workout_name,
       w.performed_on AS performed_on,
       w.user_id AS author_id,
       p.username AS author_username,
       p.display_name AS author_display_name,
       p.avatar_url AS author_avatar_url
     FROM workouts w
     LEFT JOIN profiles p ON p.id = w.user_id
     WHERE w.user_id = ?
        OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ? AND f.followee_id = w.user_id
        )
     ORDER BY w.performed_on DESC, w.created_at DESC
     LIMIT 100`,
    [myId, myId]
  );

  if (rows.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center">
        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
          <Users className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="font-medium">Your feed is empty</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Follow some friends to see their sessions, drop emotes, and leave comments here.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {rows.map((r) => {
        const author = r.author_username
          ? `@${r.author_username}`
          : r.author_display_name ?? "Unknown";
        const initial = (r.author_username ?? r.author_display_name ?? "?")
          .slice(0, 1)
          .toUpperCase();
        return (
          <li
            key={r.workout_id}
            className="flex items-center rounded-2xl border border-border bg-card overflow-hidden"
          >
            <Link
              to={`/users/${r.author_id}`}
              className="p-4 pr-2 hover:bg-muted/30"
              aria-label={`${author}'s profile`}
            >
              {r.author_avatar_url ? (
                <img
                  src={r.author_avatar_url}
                  alt=""
                  className="h-10 w-10 rounded-full shrink-0"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">
                  {initial}
                </div>
              )}
            </Link>
            <Link
              to={
                r.author_id === myId
                  ? `/log/${r.workout_id}?from=${encodeURIComponent("/friends")}`
                  : `/friends/sessions/${r.workout_id}`
              }
              className="flex items-center gap-3 flex-1 p-4 pl-2 min-w-0 hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.workout_name}</div>
                <div className="truncate text-xs text-muted-foreground">{author}</div>
              </div>
              <div className="text-sm text-muted-foreground shrink-0">
                {format(parseISO(r.performed_on), "EEE d MMM")}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function FollowingView() {
  const { user } = useAuth();
  const myId = user?.id ?? "";

  // Local: who I follow. Reactive — flips Follow/Unfollow button state.
  const { data: followRows } = useQuery<FollowRow>(
    `SELECT * FROM follows WHERE follower_id = ?`,
    [myId]
  );
  const followingIds = new Set(followRows.map((r) => r.followee_id ?? ""));

  // Remote: discoverable profiles. One-shot Supabase fetch — see lib/supabase/profiles.ts
  // for the local-first rationale (discovery is not synced).
  const {
    data: profiles = [],
    isLoading,
    error,
  } = useReactQuery({
    queryKey: ["discoverable-profiles", myId],
    queryFn: () => fetchDiscoverableProfiles(myId),
    enabled: !!myId,
  });

  if (isLoading) {
    return (
      <div className="mt-8 flex justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="mt-4 px-1 text-sm text-red-600">
        Couldn't load suggestions. {error instanceof Error ? error.message : ""}
      </p>
    );
  }
  if (profiles.length === 0) {
    return (
      <p className="mt-4 px-1 text-sm text-muted-foreground">No other users yet.</p>
    );
  }

  const following = profiles.filter((p) => followingIds.has(p.id));
  const suggested = profiles.filter((p) => !followingIds.has(p.id));

  return (
    <div className="mt-4 flex flex-col gap-6">
      {following.length > 0 && (
        <ProfileSection title="Following" profiles={following} isFollowing={true} />
      )}
      {suggested.length > 0 && (
        <ProfileSection title="Suggested" profiles={suggested} isFollowing={false} />
      )}
    </div>
  );
}

function ProfileSection({
  title,
  profiles,
  isFollowing,
}: {
  title: string;
  profiles: PublicProfile[];
  isFollowing: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <Card className="p-0 divide-y divide-border">
        {profiles.map((p) => (
          <SuggestedRow key={p.id} profile={p} isFollowing={isFollowing} />
        ))}
      </Card>
    </section>
  );
}

function SuggestedRow({
  profile,
  isFollowing,
}: {
  profile: PublicProfile;
  isFollowing: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const label =
    profile.username ?? profile.displayName ?? "Unnamed user";
  const initial = (profile.username ?? profile.displayName ?? "?")
    .slice(0, 1)
    .toUpperCase();

  function toggle() {
    startTransition(async () => {
      try {
        if (isFollowing) {
          await unfollowUser(profile.id);
        } else {
          await followUser(profile.id);
        }
      } catch (err) {
        console.error("[friends] follow toggle failed:", err);
      }
    });
  }

  return (
    <div className="flex items-center gap-3 p-3">
      <Link
        to={`/users/${profile.id}`}
        className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80"
      >
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-medium flex-shrink-0">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {profile.username ? `@${profile.username}` : label}
          </div>
          {profile.username && profile.displayName && (
            <div className="truncate text-sm text-muted-foreground">
              {profile.displayName}
            </div>
          )}
        </div>
      </Link>
      <Button
        size="sm"
        variant={isFollowing ? "outline" : "default"}
        onClick={toggle}
        disabled={pending}
        className="flex-shrink-0"
      >
        {isFollowing ? "Unfollow" : "Follow"}
      </Button>
    </div>
  );
}

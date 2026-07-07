import { useEffect, useState, useTransition } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useAuth } from "@/lib/auth/auth-context";
import type { FollowRow } from "@/lib/db/schema";
import { getFeedSessions, type FeedSessionEntry } from "@/lib/db/queries";
import { fetchDiscoverableProfiles, type PublicProfile } from "@/lib/supabase/profiles";
import { followUser, unfollowUser } from "@/lib/mutations/follows";
import { FeedFriendsRail } from "./feed-friends-rail";
import { FeedSessionCard } from "./feed-session-card";

type Tab = "feed" | "following";

export function Friends() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "feed";
  function setTab(t: Tab) { setSearchParams({ tab: t }, { replace: true }); }

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

  // Reactive signature: when PowerSync streams in any new workout/set/follow
  // row within scope, this re-renders and the effect below re-fetches the
  // highlights. Without a signature, the one-shot fetch wouldn't see updates.
  const { data: sigRows = [] } = useQuery<{ sig: string }>(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM workouts), 0)
       || '|' ||
       COALESCE((SELECT COUNT(*) FROM sets), 0)
       || '|' ||
       COALESCE((SELECT MAX(updated_at) FROM workouts), '')
       || '|' ||
       COALESCE((SELECT COUNT(*) FROM follows WHERE follower_id = ?), 0)
       AS sig`,
    [myId]
  );
  const dataSignature = sigRows[0]?.sig ?? "";

  const [entries, setEntries] = useState<FeedSessionEntry[] | null>(null);

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    getFeedSessions(myId).then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => {
      cancelled = true;
    };
  }, [myId, dataSignature]);

  return (
    <>
      <div className="mt-4">
        <FeedFriendsRail />
      </div>
      {entries === null ? (
        <div className="mt-8 flex justify-center">
          <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Dumbbell className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-medium">Your feed is empty</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Log a session — or follow some friends — and your sessions will show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {entries.map((e) => (
            <li key={e.workoutId}>
              <FeedSessionCard entry={e} isMine={e.authorId === myId} />
            </li>
          ))}
        </ul>
      )}
    </>
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
  const location = useLocation();
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
        to={`/users/${profile.id}?from=${encodeURIComponent(location.pathname + location.search)}`}
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

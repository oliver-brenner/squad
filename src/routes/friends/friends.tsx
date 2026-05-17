import { useState, useTransition } from "react";
import { useQuery } from "@powersync/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import type { FollowRow } from "@/lib/db/schema";
import { fetchDiscoverableProfiles, type PublicProfile } from "@/lib/supabase/profiles";
import { followUser, unfollowUser } from "@/lib/mutations/follows";

type Tab = "feed" | "following";

export function Friends() {
  const [tab, setTab] = useState<Tab>("feed");

  return (
    <>
      <PageHeader title="Friends" />
      <TabSwitcher value={tab} onChange={setTab} />
      {tab === "feed" ? <FeedView /> : <FollowingView />}
    </>
  );
}

function TabSwitcher({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted">
      {(["feed", "following"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "h-10 rounded-lg text-sm font-medium transition-colors",
            value === t
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t === "feed" ? "Feed" : "Following"}
        </button>
      ))}
    </div>
  );
}

function FeedView() {
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

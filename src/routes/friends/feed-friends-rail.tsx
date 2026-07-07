import { Link } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import type { ProfileRow } from "@/lib/db/schema";

// Horizontal, scrollable rail of the people you follow — tap an avatar to open
// their profile. Leads with a "You" avatar (your own profile). The followees'
// profile rows are already local (the followee_profiles sync bucket), so this
// is a plain reactive query — it updates the instant a follow toggles.
export function FeedFriendsRail() {
  const { user } = useAuth();
  const myId = user?.id ?? "";

  const { data: me = [] } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [myId]
  );
  // Ordered so whoever surfaces most recently in the feed comes first — by
  // each followee's latest session (performed_on, then created_at), newest
  // first. Followees with no sessions fall to the end (alphabetical). "You" is
  // pinned first in the JSX below, independent of this ordering.
  const { data: following = [] } = useQuery<ProfileRow>(
    `SELECT p.* FROM profiles p
     INNER JOIN follows f ON f.followee_id = p.id
     WHERE f.follower_id = ?
     ORDER BY
       (SELECT MAX(w.performed_on) FROM workouts w WHERE w.user_id = p.id) DESC NULLS LAST,
       (SELECT MAX(w.created_at) FROM workouts w WHERE w.user_id = p.id) DESC NULLS LAST,
       p.username IS NULL, p.username, p.display_name`,
    [myId]
  );

  // Nothing to select if you follow no one — hide the rail entirely.
  if (following.length === 0) return null;

  return (
    <div className="-mx-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex gap-4 px-1">
        {me[0] && <RailAvatar profile={me[0]} label="You" />}
        {following.map((p) => (
          <RailAvatar key={p.id} profile={p} />
        ))}
      </ul>
    </div>
  );
}

function RailAvatar({ profile, label }: { profile: ProfileRow; label?: string }) {
  const name = label ?? (profile.username ? `@${profile.username}` : profile.display_name ?? "?");
  const initial = (profile.username ?? profile.display_name ?? "?").slice(0, 1).toUpperCase();

  return (
    <li className="flex-shrink-0">
      <Link
        to={`/users/${profile.id}?from=${encodeURIComponent("/friends")}`}
        className="flex w-16 flex-col items-center gap-1 hover:opacity-80"
      >
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-14 w-14 rounded-full ring-2 ring-border"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-medium ring-2 ring-border">
            {initial}
          </div>
        )}
        <span className="w-full truncate text-center text-xs text-muted-foreground">
          {name}
        </span>
      </Link>
    </li>
  );
}

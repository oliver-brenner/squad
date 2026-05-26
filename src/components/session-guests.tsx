import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useQuery } from "@powersync/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { fetchProfilesByIds } from "@/lib/supabase/profiles";

// A guest tagged on a session. On-Squad guests (guestProfileId set) have their
// name/avatar resolved live from the profiles table; off-Squad guests carry a
// plain guestName and no avatar.
type GuestRow = {
  id: string;
  guest_profile_id: string | null;
  guest_name: string | null;
  // Joined profile columns (null when the profile isn't synced locally).
  p_id: string | null;
  p_username: string | null;
  p_display_name: string | null;
  p_avatar_url: string | null;
};

type ResolvedGuest = {
  id: string;
  profileId: string | null;
  firstName: string;
  fullName: string;
  avatarUrl: string | null;
};

function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

function Avatar({
  name,
  avatarUrl,
  size,
  ring,
}: {
  name: string;
  avatarUrl: string | null;
  size: "sm" | "md";
  ring?: boolean;
}) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs";
  const ringCls = ring ? "ring-2 ring-card" : "";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${dim} ${ringCls} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dim} ${ringCls} rounded-full bg-muted flex items-center justify-center font-medium flex-shrink-0`}
    >
      {(name.slice(0, 1) || "?").toUpperCase()}
    </div>
  );
}

type Props = {
  workoutId: string;
  // "card": compact, non-interactive cue (overlapping avatars + names).
  // "page": larger, each on-Squad guest links to their profile.
  variant: "card" | "page";
  // Where the profile link should return to (page variant only).
  backHref?: string;
};

export function SessionGuests({ workoutId, variant, backHref }: Props) {
  const { data: rows = [] } = useQuery<GuestRow>(
    `SELECT g.id, g.guest_profile_id, g.guest_name,
            p.id AS p_id, p.username AS p_username,
            p.display_name AS p_display_name, p.avatar_url AS p_avatar_url
     FROM session_guests g
     LEFT JOIN profiles p ON p.id = g.guest_profile_id
     WHERE g.workout_id = ?
     ORDER BY g.position ASC`,
    [workoutId]
  );

  // On-Squad guests whose profile hasn't synced locally — resolve them live
  // from Supabase so a friend viewing your session still sees the guest's name
  // and avatar even when they don't follow that guest.
  const missingIds = rows
    .filter((r) => r.guest_profile_id && !r.p_id)
    .map((r) => r.guest_profile_id as string);
  const missingKey = [...new Set(missingIds)].sort().join(",");

  const { data: remoteProfiles = [] } = useReactQuery({
    queryKey: ["guest-profiles", missingKey],
    queryFn: () => fetchProfilesByIds(missingKey ? missingKey.split(",") : []),
    enabled: missingKey.length > 0,
  });
  const remoteById = new Map(remoteProfiles.map((p) => [p.id, p]));

  const guests: ResolvedGuest[] = rows.map((r) => {
    if (r.guest_profile_id) {
      const remote = remoteById.get(r.guest_profile_id);
      const fullName =
        r.p_display_name ??
        r.p_username ??
        remote?.displayName ??
        remote?.username ??
        "Squad member";
      return {
        id: r.id,
        profileId: r.guest_profile_id,
        firstName: firstNameOf(fullName),
        fullName,
        avatarUrl: r.p_avatar_url ?? remote?.avatarUrl ?? null,
      };
    }
    const name = r.guest_name ?? "Guest";
    return {
      id: r.id,
      profileId: null,
      firstName: firstNameOf(name),
      fullName: name,
      avatarUrl: null,
    };
  });

  if (guests.length === 0) return null;

  if (variant === "card") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Plus className="h-3.5 w-3.5 flex-shrink-0" />
        <div className="flex -space-x-1.5 flex-shrink-0">
          {guests.map((g) => (
            <Avatar key={g.id} name={g.firstName} avatarUrl={g.avatarUrl} size="sm" ring />
          ))}
        </div>
        <span className="truncate">{guests.map((g) => g.firstName).join(", ")}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-sm text-muted-foreground">
      <Plus className="h-4 w-4 flex-shrink-0" />
      {guests.map((g) => {
        const inner = (
          <>
            <Avatar name={g.firstName} avatarUrl={g.avatarUrl} size="md" />
            <span className="font-medium text-foreground/80">{g.firstName}</span>
          </>
        );
        if (g.profileId) {
          return (
            <Link
              key={g.id}
              to={`/users/${g.profileId}${
                backHref ? `?from=${encodeURIComponent(backHref)}` : ""
              }`}
              className="flex items-center gap-1.5 hover:opacity-80"
            >
              {inner}
            </Link>
          );
        }
        return (
          <span key={g.id} className="flex items-center gap-1.5">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

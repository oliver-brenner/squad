import { supabase } from "./client";

// Public-facing profile shape used in social UIs (search, suggestions, feed
// authors). Kept narrow on purpose — never expose anything that isn't safe to
// show to other users.
export type PublicProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
};

// Returns every profile except the signed-in user.
//
// Requires an RLS policy on `profiles` that allows authenticated users to
// SELECT rows other than their own — for example:
//
//   CREATE POLICY profiles_read_authenticated ON profiles
//     FOR SELECT TO authenticated USING (true);
//
// Without that policy, this returns an empty list (RLS silently filters rows).
export async function fetchDiscoverableProfiles(currentUserId: string): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, created_at")
    .neq("id", currentUserId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPublicProfile);
}

// Single-profile lookup. Used by the user-profile page when the local DB
// hasn't synced a row (e.g. you're viewing someone you don't follow, or just
// unfollowed and PowerSync evicted their profile). Same RLS requirements as
// fetchDiscoverableProfiles.
export async function fetchProfileById(id: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPublicProfile(data) : null;
}

// Batch lookup for a set of ids. Used to resolve on-Squad session guests whose
// profiles haven't synced locally (e.g. a friend's guest you don't follow).
// Same RLS requirements as fetchDiscoverableProfiles.
export async function fetchProfilesByIds(ids: string[]): Promise<PublicProfile[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, created_at")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []).map(rowToPublicProfile);
}

function rowToPublicProfile(r: Record<string, unknown>): PublicProfile {
  return {
    id: r.id as string,
    username: (r.username as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  };
}

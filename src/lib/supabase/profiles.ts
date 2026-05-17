import { supabase } from "./client";

// Public-facing profile shape used in social UIs (search, suggestions, feed
// authors). Kept narrow on purpose — never expose anything that isn't safe to
// show to other users.
export type PublicProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
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
    .select("id, username, display_name, avatar_url")
    .neq("id", currentUserId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    username: (r.username as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
  }));
}

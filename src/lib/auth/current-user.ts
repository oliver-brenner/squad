import { supabase } from "@/lib/supabase/client";

// Single source of truth for "who am I?" in non-React code paths (queries,
// mutations, exporters). React components should prefer `useAuth().user?.id`
// so reactive queries refire when the user changes.
//
// Background: before friends sync, the assumption everywhere was "local
// SQLite only contains my data, so user_id filters are unnecessary." Once
// followees' workouts sync down, every query/mutation needs to discriminate.
// This helper makes that discrimination cheap to thread through.
export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

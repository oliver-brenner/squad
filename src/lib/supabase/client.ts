import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Single browser client. Sessions live in localStorage by default
// (persistSession: true) so reloads stay logged in. Without SSR there's no
// cookie/middleware dance — supabase-js owns the session lifecycle.
export const supabase: SupabaseClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

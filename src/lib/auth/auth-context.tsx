import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  // `loading` is true only on initial mount while we're hydrating the session
  // from storage. Subsequent auth state changes don't flip this back to true.
  loading: boolean;
};

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({
        session: data.session,
        user: data.session?.user ?? null,
        loading: false,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      // Skip state updates that don't change the signed-in user. supabase-js
      // re-emits events for TOKEN_REFRESHED and on tab visibility changes
      // (especially on iOS Safari) — without this guard, every refresh would
      // produce a new user object reference and ripple through downstream
      // effects that depend on `user`.
      setState((prev) => {
        if (prev.user?.id === nextUser?.id && !prev.loading) {
          return { ...prev, session };
        }
        return { session, user: nextUser, loading: false };
      });
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

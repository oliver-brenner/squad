import { Outlet } from "react-router-dom";
import { QueryProvider } from "@/components/providers/query-provider";
import { UserFieldOptionsProvider } from "@/components/providers/user-field-options-provider";
import { TimerProvider } from "@/components/providers/timer-provider";
import { TimerBar } from "@/components/timer/timer-bar";
import { BottomNav } from "@/components/nav/bottom-nav";

// Shell shared by every authenticated route. Mounts inside AuthGuard (auth
// already enforced) and PowerSyncProvider (local DB initialised + bootstrap
// completed), so any descendant can call useQuery/useUserFieldOptions safely.
export function AppLayout() {
  return (
    <QueryProvider>
      <UserFieldOptionsProvider>
        <TimerProvider>
          <div className="flex min-h-dvh flex-col">
            {/* Bottom padding clears the nav (6rem) plus the timer bar when
                present — its measured height is published as --timer-bar-h so
                pinned-bottom content (e.g. Add exercise) stays scrollable. */}
            <main
              className="flex-1 mx-auto w-full max-w-2xl px-4"
              style={{ paddingBottom: "calc(6rem + var(--timer-bar-h, 0px))" }}
            >
              <Outlet />
            </main>
            <div className="fixed inset-x-0 bottom-0 z-40">
              <TimerBar />
              <BottomNav />
            </div>
          </div>
        </TimerProvider>
      </UserFieldOptionsProvider>
    </QueryProvider>
  );
}

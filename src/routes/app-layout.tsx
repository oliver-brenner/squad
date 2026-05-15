import { Outlet } from "react-router-dom";
import { QueryProvider } from "@/components/providers/query-provider";
import { UserFieldOptionsProvider } from "@/components/providers/user-field-options-provider";
import { BottomNav } from "@/components/nav/bottom-nav";
import { NewSessionPin } from "@/components/nav/new-session-pin";

// Shell shared by every authenticated route. Mounts inside AuthGuard (auth
// already enforced) and PowerSyncProvider (local DB initialised + bootstrap
// completed), so any descendant can call useQuery/useUserFieldOptions safely.
export function AppLayout() {
  return (
    <QueryProvider>
      <UserFieldOptionsProvider>
        <div className="flex min-h-dvh flex-col">
          <main className="flex-1 mx-auto w-full max-w-2xl px-4 pb-6">
            <Outlet />
          </main>
          <div className="sticky bottom-0 z-40">
            <NewSessionPin />
            <BottomNav />
          </div>
        </div>
      </UserFieldOptionsProvider>
    </QueryProvider>
  );
}

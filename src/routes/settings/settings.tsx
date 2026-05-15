import { Link } from "react-router-dom";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { supabase } from "@/lib/supabase/client";

export function Settings() {
  const { user } = useAuth();
  const name =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    "You";

  return (
    <>
      <PageHeader title="You" />

      <Card>
        <CardContent className="pt-6 flex items-center gap-4">
          {user?.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url as string}
              alt=""
              className="h-14 w-14 rounded-full"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center font-semibold text-lg">
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{name}</div>
            <div className="truncate text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 p-0">
        <Link
          to="/settings/fields"
          className="flex items-center gap-3 p-4 hover:bg-muted/50"
        >
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Customise fields</div>
            <div className="text-sm text-muted-foreground">
              Edit categories, equipment, and muscle groups
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </Card>

      <Button
        variant="outline"
        size="lg"
        className="w-full mt-4"
        onClick={() => supabase.auth.signOut()}
      >
        Sign out
      </Button>
    </>
  );
}

import { Link, useLocation } from "react-router-dom";
import { Home, List, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarbellIcon } from "@/components/exercise-meta";

const items = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/log", label: "Log", icon: List },
  // Templates live under the Exercises tab (reached from it), so keep Exercises
  // highlighted while on any /templates route.
  { href: "/exercises", label: "Exercises", icon: BarbellIcon, also: ["/templates"] },
  { href: "/friends", label: "Squad", icon: Users },
  { href: "/you", label: "You", icon: User },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {items.map((item) => {
          const { href, label, icon: Icon } = item;
          const matches = [href, ...(("also" in item && item.also) || [])];
          const active = matches.some((p) => pathname === p || pathname.startsWith(`${p}/`));
          return (
            <li key={href} className="flex-1">
              <Link
                to={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 text-xs transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.5 : 2} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

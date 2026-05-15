import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NewSessionPin() {
  const { pathname } = useLocation();
  if (pathname !== "/dashboard") return null;

  return (
    <div className="border-t border-border bg-background/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Link to="/log/new">
        <Button className="w-full" size="lg">
          New session
        </Button>
      </Link>
    </div>
  );
}

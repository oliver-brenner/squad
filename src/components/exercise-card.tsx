import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import type { Exercise } from "@/lib/db/types";

interface ExerciseCardProps {
  exercise: Exercise;
  showMeta?: boolean;
  href?: string;
  onClick?: () => void;
  action?: React.ReactNode;
}

export function ExerciseCard({ exercise, showMeta = true, href, onClick, action }: ExerciseCardProps) {
  const content = (
    <div className="min-w-0 flex-1 flex flex-col gap-1 p-3">
      <span className="font-medium truncate">{exercise.name}</span>
      {showMeta && (
        <span className="text-xs text-muted-foreground flex flex-wrap items-center gap-0.5">
          <ExerciseMetaTags e={exercise} />
        </span>
      )}
    </div>
  );

  return (
    <Card
      className={`flex items-center overflow-hidden p-0${onClick ? " cursor-pointer hover:bg-muted/40 transition-colors" : ""}`}
      onClick={onClick}
    >
      {href ? (
        <Link to={href} className="min-w-0 flex-1 flex flex-col gap-1 py-3 pl-3 pr-0">
          <span className="font-medium truncate">{exercise.name}</span>
          {showMeta && (
            <span className="text-xs text-muted-foreground flex flex-wrap items-center gap-0.5">
              <ExerciseMetaTags e={exercise} />
            </span>
          )}
        </Link>
      ) : (
        content
      )}
      {action}
    </Card>
  );
}

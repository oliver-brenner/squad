import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import type { TemplateRow } from "@/lib/db/schema";
import { decodeTemplate } from "@/lib/db/decoders";
import type { Template } from "@/lib/db/types";
import { sessionTypeColor } from "@/lib/session-type-color";

// Bottom-sheet list of the user's templates, shown from the new-session screen's
// "Use Template" section. Picking one hands the full template back to the caller.
export function TemplatePickerSheet({
  onSelect,
  onClose,
}: {
  onSelect: (template: Template) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const { data: rows = [] } = useQuery<TemplateRow>(
    `SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );
  const templates = useMemo(() => rows.map(decodeTemplate), [rows]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] flex flex-col rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted flex-shrink-0" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <h2 className="text-base font-semibold">Use a template</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-6 flex flex-col gap-1">
          {templates.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              You don't have any templates yet. Create one from the Exercises tab.
            </p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className="flex items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-muted/50"
              >
                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(t.sessionType)}`} />
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ExerciseGroup } from "./workout-editor-types";

// The "+ Add variation" control shown next to an exercise's title inside a
// session. Only the variations the exercise has attached (ex.variations) are
// offered; selecting one stores its key on the group, displayed as the label
// with a clear (×) affordance. Rendered nowhere when the exercise has no
// variations attached — callers guard on that.
export function VariationControl({
  group,
  onChange,
}: {
  group: ExerciseGroup;
  onChange: (variation: string | null) => void;
}) {
  const [trayOpen, setTrayOpen] = useState(false);

  // Variations belong to the exercise (key + label, in saved order), so offer
  // them directly — no library lookup needed.
  const options = group.exercise.variations ?? [];
  if (options.length === 0) return null;

  const selectedLabel = group.variation
    ? options.find((o) => o.key === group.variation)?.label ?? null
    : null;

  return (
    <>
      {/* min-h-6 = at least one title line tall; items-center keeps a single-
          line control vertically centered on the title's first line. The
          parent row is items-start, so a control that wraps to multiple rows
          starts at the first line and grows downward. max-w caps the width so
          a long variation name wraps inside the pill instead of crowding out
          the title. */}
      <span className="inline-flex min-h-6 max-w-[40%] items-center">
      {selectedLabel ? (
        <span className="inline-flex items-center gap-1 rounded-2xl bg-muted pl-2.5 pr-1 py-1.5 text-xs font-medium text-foreground">
          <span className="min-w-0 break-words leading-[1.1]">{selectedLabel}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            aria-label="Remove variation"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTrayOpen(true);
          }}
          className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Add variation
        </button>
      )}
      </span>

      {trayOpen && (
        <VariationTray
          options={options}
          selected={group.variation}
          onSelect={(key) => {
            onChange(key);
            setTrayOpen(false);
          }}
          onClose={() => setTrayOpen(false)}
        />
      )}
    </>
  );
}

function VariationTray({
  options,
  selected,
  onSelect,
  onClose,
}: {
  options: Array<{ key: string; label: string }>;
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col py-4 gap-2 px-4">
          <h2 className="px-2 pb-1 text-sm font-medium text-muted-foreground">
            Select a variation
          </h2>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onSelect(o.key)}
              className={`w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50 ${
                selected === o.key ? "bg-muted" : ""
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

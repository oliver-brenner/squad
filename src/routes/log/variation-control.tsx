import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { Dot, exerciseHasMetaTags } from "@/components/exercise-meta";
import type { ExerciseGroup } from "./workout-editor-types";

// The "+ Add variation" pill shown next to an exercise's title inside a
// session. Only the variations the exercise has attached (ex.variations) are
// offered. Renders nothing once a variation is selected — the selection then
// shows as a tag at the end of the exercise's meta line (see VariationTag) —
// and nothing when the exercise has no variations attached.
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
  if (options.length === 0 || group.variation) return null;

  return (
    <>
      {/* min-h-6 = at least one title line tall; items-center keeps a single-
          line control vertically centered on the title's first line. The
          parent row is items-start, so a control that wraps to multiple rows
          starts at the first line and grows downward. max-w caps the width so
          a long variation name wraps inside the pill instead of crowding out
          the title. */}
      <span className="inline-flex min-h-6 max-w-[40%] items-center">
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
      </span>

      {trayOpen && (
        <VariationTray
          options={options}
          selected={null}
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

// The selected variation rendered as a lowercased tag at the end of the
// exercise's meta line. Clicking it reopens the tray, where "None" clears the
// selection (returning the "+ Add variation" pill) or another variation can be
// chosen. Renders nothing when no variation is selected.
export function VariationTag({
  group,
  onChange,
}: {
  group: ExerciseGroup;
  onChange: (variation: string | null) => void;
}) {
  const [trayOpen, setTrayOpen] = useState(false);

  const options = group.exercise.variations ?? [];
  const selectedLabel = group.variation
    ? options.find((o) => o.key === group.variation)?.label ?? null
    : null;
  if (options.length === 0 || !selectedLabel) return null;

  return (
    <>
      {/* Match how the meta tags delimit themselves — a Dot before the tag,
          but only when there's a preceding tag to separate it from. */}
      {exerciseHasMetaTags(group.exercise) && (
        <span className="inline-flex items-center mx-1">
          <Dot />
        </span>
      )}
      {/* A span (not a button) so it stays valid HTML when the meta line is
          itself a clickable button, as in circuit rows. */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setTrayOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setTrayOpen(true);
          }
        }}
        className="cursor-pointer whitespace-nowrap underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
      >
        {selectedLabel.toLowerCase()}
      </span>

      {trayOpen && (
        <VariationTray
          options={options}
          selected={group.variation}
          showNone
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
  showNone = false,
}: {
  options: Array<{ key: string; label: string }>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onClose: () => void;
  showNone?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Portalled to the body so the fixed bottom sheet isn't clipped by — or
  // nested illegally inside — whatever triggered it (e.g. a button-wrapped
  // meta line in circuit rows). stopPropagation on the backdrop and sheet is
  // essential there: React bubbles portal events through the React tree, not
  // the DOM, so without it a click inside the tray would reach that ancestor
  // button and open the exercise editor.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col py-4 gap-2 px-4">
          <h2 className="px-2 pb-1 text-sm font-medium text-muted-foreground">
            Select a variation
          </h2>
          {showNone && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50 ${
                selected === null ? "bg-muted" : ""
              }`}
            >
              None
            </button>
          )}
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
    </>,
    document.body
  );
}

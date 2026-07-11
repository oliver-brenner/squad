// Interactive body silhouette: shades each muscle region by 0..1 heat and
// reports taps. Front and back render as separate <svg>s from the shared
// artboard in body-data.ts.

import { useMemo, useState } from "react";
import { RotateCcw, ZoomIn } from "lucide-react";
import {
  BODY_OUTLINE,
  BODY_PARTS,
  BODY_VIEWBOX,
  type BodyPart,
  type BodyRegionSlug,
} from "./body-data";

// A continuous control scale — dark blue → light blue → light orange → dark
// red — sampled into discrete segments. Putting the blue↔orange handoff at the
// LIGHT end of both means the crossover passes through pale tones, never the
// dark muddy grey-brown you get blending a dark blue straight into a dark
// orange. We then quantise into fixed segments so the map steps in clear
// increments rather than a smooth wash. Grey = no sets, sitting below it all.
const HEAT_GREY: [number, number, number] = [71, 85, 105]; // slate — no sets

const HEAT_CONTROL: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [29, 78, 216] }, // dark blue (blue-700)
  { at: 0.34, rgb: [147, 197, 253] }, // light blue (blue-300)
  { at: 0.66, rgb: [253, 186, 116] }, // light orange (orange-300)
  { at: 1, rgb: [185, 28, 28] }, // dark red (red-700)
];

function sampleControl(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  let lo = HEAT_CONTROL[0];
  let hi = HEAT_CONTROL[HEAT_CONTROL.length - 1];
  for (let i = 0; i < HEAT_CONTROL.length - 1; i++) {
    if (x >= HEAT_CONTROL[i].at && x <= HEAT_CONTROL[i + 1].at) {
      lo = HEAT_CONTROL[i];
      hi = HEAT_CONTROL[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const f = (x - lo.at) / span;
  return lo.rgb.map((v, i) => Math.round(v + (hi.rgb[i] - v) * f)) as [
    number,
    number,
    number,
  ];
}

// Positions along the continuous scale to quantise into discrete steps. Blue
// and red ends carry extra samples for finer resolution where it matters, and
// there is a gap across the palest crossover (~0.5) so no region is painted
// the washed-out near-white tone between light blue and light orange.
const HEAT_SAMPLE_POINTS = [
  0.03, // darkest blue
  0.14, // dark blue
  0.28, // light blue
  0.6, // light orange (jumps past the palest crossover)
  0.72, // orange
  0.83, // orange-red
  0.92, // red
  1.0, // darkest red
];
const HEAT_LADDER: [number, number, number][] = HEAT_SAMPLE_POINTS.map(sampleControl);

export function heatColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  if (t <= 0) {
    const [r, g, b] = HEAT_GREY;
    return `rgba(${r}, ${g}, ${b}, 0.4)`;
  }
  const idx = Math.min(HEAT_LADDER.length - 1, Math.floor(t * HEAT_LADDER.length));
  const [r, g, b] = HEAT_LADDER[idx];
  return `rgba(${r}, ${g}, ${b}, 0.85)`;
}

// Discrete swatches for the legend: grey then each sampled segment, in order.
export const HEAT_SWATCHES: string[] = [
  heatColor(0),
  ...HEAT_LADDER.map((_, i) => heatColor((i + 0.5) / HEAT_LADDER.length)),
];

const BASE_FILL = "hsl(var(--muted-foreground) / 0.13)";
const OUTLINE_STROKE = "hsl(var(--muted-foreground) / 0.4)";

// The male front/back viewBoxes happen to share one scale (724×1448 each), but
// the female ones don't — the upstream art gives the female front view extra
// margin baked into its viewBox (734×1538 vs the back's 774×1448), so the two
// views aren't drawn at the same units-per-body-size scale. Deriving a shared
// box from those raw numbers (what we tried first) just moves the mismatch:
// equal-height boxes then make the less-padded back render "bigger" than the
// front. The fix upstream actually uses is a FIXED display box (their default
// is 200×400, i.e. a 1:2 aspect) for every view regardless of its own viewBox
// proportions, with `preserveAspectRatio="xMidYMid meet"` centering whatever
// doesn't quite fill it. That's what guarantees front and back always render
// at identical size, for both sexes.
const BODY_BOX_ASPECT = "1 / 2";

function BodySide({
  sex,
  side,
  heat,
  selected,
  onSelect,
}: {
  sex: "male" | "female";
  side: "front" | "back";
  heat: Map<BodyRegionSlug, number>;
  selected: BodyRegionSlug | null;
  onSelect: (region: BodyRegionSlug) => void;
}) {
  const parts: BodyPart[] = BODY_PARTS[sex][side];
  return (
    <svg
      viewBox={BODY_VIEWBOX[sex][side]}
      className="h-auto w-full"
      style={{ aspectRatio: BODY_BOX_ASPECT }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${side} body muscle heatmap`}
    >
      <path
        d={BODY_OUTLINE[sex][side]}
        fill="none"
        stroke={OUTLINE_STROKE}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="butt"
      />
      {parts.map((part) => {
        const intensity = heat.get(part.slug);
        const interactive = intensity !== undefined;
        const isSelected = selected === part.slug;
        return (
          <g
            key={part.slug}
            fill={interactive ? heatColor(intensity) : BASE_FILL}
            stroke={isSelected ? "#fff" : "none"}
            strokeWidth={isSelected ? 4 : 0}
            onClick={
              interactive
                ? (e) => {
                    e.stopPropagation();
                    onSelect(part.slug);
                  }
                : undefined
            }
            className={interactive ? "cursor-pointer" : undefined}
            style={{ transition: "fill 400ms ease" }}
          >
            {part.paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function BodyMap({
  sex,
  heat,
  selected,
  onSelect,
  className,
}: {
  sex: "male" | "female";
  heat: Map<BodyRegionSlug, number>;
  selected: BodyRegionSlug | null;
  onSelect: (region: BodyRegionSlug | null) => void;
  className?: string;
}) {
  // Regions with zero window activity still get a faint interactive presence
  // so taps on "cold" muscles answer "when did I last train this?" upstream.
  const handleSelect = useMemo(
    () => (region: BodyRegionSlug) => onSelect(selected === region ? null : region),
    [onSelect, selected]
  );

  // Zooming shows a single side, enlarged and centred, so individual muscles
  // are easier to tap; the other side is hidden until reset.
  const [zoomed, setZoomed] = useState<"front" | "back" | null>(null);

  // Reset only undoes the zoom — deselecting a muscle is done by tapping the
  // blank space around the diagram.
  const showReset = zoomed !== null;

  function handleReset() {
    setZoomed(null);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        className="flex items-start justify-center gap-1"
        onClick={() => onSelect(null)}
      >
        {(["front", "back"] as const).map((side) => {
          if (zoomed && zoomed !== side) return null;
          return (
            <div key={side} className={zoomed ? "relative w-[72%]" : "relative min-w-0 flex-1"}>
              {!zoomed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomed(side);
                  }}
                  aria-label={`Zoom in on ${side} view`}
                  className="absolute top-1 left-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              )}
              <BodySide
                sex={sex}
                side={side}
                heat={heat}
                selected={selected}
                onSelect={handleSelect}
              />
            </div>
          );
        })}
      </div>
      {showReset && (
        <button
          onClick={handleReset}
          aria-label="Reset zoom"
          className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// Interactive body silhouette: shades each muscle region by 0..1 heat and
// reports taps. Front and back render as separate <svg>s from the shared
// artboard in body-data.ts.

import { useMemo } from "react";
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
            stroke={isSelected ? "rgb(59, 130, 246)" : "none"}
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

  return (
    <div
      className={`flex items-start justify-center gap-1 ${className ?? ""}`}
      onClick={() => onSelect(null)}
    >
      <div className="min-w-0 flex-1">
        <BodySide sex={sex} side="front" heat={heat} selected={selected} onSelect={handleSelect} />
      </div>
      <div className="min-w-0 flex-1">
        <BodySide sex={sex} side="back" heat={heat} selected={selected} onSelect={handleSelect} />
      </div>
    </div>
  );
}

// Interactive body silhouette: shades each muscle region by 0..1 heat and
// reports taps. Front and back render as separate <svg>s from the shared
// artboard in body-data.ts.

import { useMemo, useRef, useState } from "react";
import type { MouseEvent, Touch, TouchEvent } from "react";
import { RotateCcw } from "lucide-react";
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

const MIN_SCALE = 1;
const MAX_SCALE = 3;
// Below this many pixels of movement, a single-finger touch is still treated
// as a tap (so selecting a muscle while zoomed in keeps working) rather than
// a pan drag.
const PAN_THRESHOLD_PX = 6;

type Gesture =
  | { mode: "idle" }
  | { mode: "pinch"; startDist: number; startScale: number; startTx: number; startTy: number }
  | { mode: "pan"; startX: number; startY: number; startTx: number; startTy: number };

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

// Pinch-to-zoom + drag-to-pan for the body map, clamped so the content never
// pans past its own edges and never zooms out below the box's natural fit.
// A tap that doesn't move more than PAN_THRESHOLD_PX still reaches the normal
// onClick handlers below (muscle select / background deselect); only an
// actual pinch or drag suppresses the click that would otherwise follow it.
function useBodyMapZoom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const gesture = useRef<Gesture>({ mode: "idle" });
  const suppressClick = useRef(false);

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // transform is `translate(tx, ty) scale(s)` with origin (0,0), so content
  // spans [tx, tx + s*W] × [ty, ty + s*H]; keep that span covering the box.
  function clampTranslate(nextScale: number, nextTx: number, nextTy: number): [number, number] {
    const el = containerRef.current;
    if (!el) return [nextTx, nextTy];
    const { width, height } = el.getBoundingClientRect();
    const minX = width * (1 - nextScale);
    const minY = height * (1 - nextScale);
    return [clamp(nextTx, minX, 0), clamp(nextTy, minY, 0)];
  }

  function reset() {
    setScale(1);
    setTx(0);
    setTy(0);
    gesture.current = { mode: "idle" };
  }

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      gesture.current = {
        mode: "pinch",
        startDist: touchDist(e.touches[0], e.touches[1]),
        startScale: scale,
        startTx: tx,
        startTy: ty,
      };
    } else if (e.touches.length === 1 && scale > 1) {
      gesture.current = {
        mode: "pan",
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTx: tx,
        startTy: ty,
      };
    } else {
      gesture.current = { mode: "idle" };
    }
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
    const el = containerRef.current;
    if (!el) return;

    if (g.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const newDist = touchDist(e.touches[0], e.touches[1]);
      const newScale = clamp((newDist / g.startDist) * g.startScale, MIN_SCALE, MAX_SCALE);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      // Keep the content point under the pinch midpoint fixed on screen.
      const contentX = (midX - g.startTx) / g.startScale;
      const contentY = (midY - g.startTy) / g.startScale;
      const [nextTx, nextTy] = clampTranslate(
        newScale,
        midX - newScale * contentX,
        midY - newScale * contentY
      );
      setScale(newScale);
      setTx(nextTx);
      setTy(nextTy);
      suppressClick.current = true;
    } else if (g.mode === "pan" && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      if (suppressClick.current || Math.hypot(dx, dy) > PAN_THRESHOLD_PX) {
        e.preventDefault();
        suppressClick.current = true;
        const [nextTx, nextTy] = clampTranslate(scale, g.startTx + dx, g.startTy + dy);
        setTx(nextTx);
        setTy(nextTy);
      }
    }
  }

  function onTouchEnd() {
    gesture.current = { mode: "idle" };
  }

  // Capture phase: swallow the click that follows an actual pinch/pan so it
  // doesn't also toggle a muscle's selection or deselect the background.
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  }

  return {
    containerRef,
    scale,
    tx,
    ty,
    reset,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onClickCapture,
  };
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

  const {
    containerRef,
    scale,
    tx,
    ty,
    reset,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onClickCapture,
  } = useBodyMapZoom();

  const isDefault = scale === 1 && tx === 0 && ty === 0;
  const showReset = !isDefault || selected !== null;

  function handleReset() {
    reset();
    onSelect(null);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        ref={containerRef}
        className="overflow-hidden"
        onClick={() => onSelect(null)}
        onClickCapture={onClickCapture}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="flex items-start justify-center gap-1"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
            transition: isDefault ? "transform 250ms ease" : "none",
          }}
        >
          <div className="min-w-0 flex-1">
            <BodySide
              sex={sex}
              side="front"
              heat={heat}
              selected={selected}
              onSelect={handleSelect}
            />
          </div>
          <div className="min-w-0 flex-1">
            <BodySide
              sex={sex}
              side="back"
              heat={heat}
              selected={selected}
              onSelect={handleSelect}
            />
          </div>
        </div>
      </div>
      {showReset && (
        <button
          onClick={handleReset}
          aria-label="Reset zoom and selection"
          className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";

// Returns the height (px) the on-screen keyboard is covering at the bottom of
// the layout viewport. 0 when no keyboard (or when visualViewport is missing).
// Use as the `bottom` offset of a fixed-position element so it sits above the
// software keyboard on mobile browsers.
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setOffset(gap > 1 ? gap : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return offset;
}

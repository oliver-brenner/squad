import { PB_LABEL, type PBType } from "@/lib/stats/set-pbs";

// Multiple PB types collapse into a single pill (e.g. `PB RM+VOL`) to save
// horizontal space on the set row — order is preserved from the input array,
// which the computer already aligns with the metric display order.
export function PBBadges({ types }: { types: PBType[] }) {
  if (types.length === 0) return null;
  const label = types.map((t) => PB_LABEL[t]).join("+");
  return (
    <span
      className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 leading-4 align-middle"
      title={`Personal best · ${types.join(", ")}`}
    >
      PB&nbsp;{label}
    </span>
  );
}

// A brand-new exercise for the author — its first-ever appearance in a session.
// Same pill shape as PBBadges, emerald-tinted to read as "new" not "record".
export function NewBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 leading-4 align-middle"
      title="First time logging this exercise"
    >
      New
    </span>
  );
}

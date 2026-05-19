import { PB_LABEL, type PBType } from "@/lib/stats/set-pbs";

export function PBBadge({ type }: { type: PBType }) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 leading-4"
      title={`Personal best · ${type}`}
    >
      PB&nbsp;{PB_LABEL[type]}
    </span>
  );
}

export function PBBadges({ types }: { types: PBType[] }) {
  if (types.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {types.map((t) => (
        <PBBadge key={t} type={t} />
      ))}
    </span>
  );
}

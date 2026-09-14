/**
 * Where the firm's transactions stand: coded, awaiting review, not yet
 * coded. A pure SVG ring — the page passes counts in, nothing is fetched.
 */

const SEGMENTS = [
  { key: "coded", label: "Coded & accepted", color: "#12b76a" },
  { key: "awaiting", label: "Awaiting review", color: "#f59e0b" },
  { key: "notCoded", label: "Not yet coded", color: "#6366f1" },
] as const;

export function WorkDonut({
  total,
  awaiting,
  notCoded,
}: {
  total: number;
  awaiting: number;
  notCoded: number;
}) {
  const coded = Math.max(0, total - awaiting - notCoded);
  const values = { coded, awaiting, notCoded };
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const pct = (n: number) => (total > 0 ? n / total : 0);
  const codedPct = Math.round(pct(coded) * 100);

  let offset = 0;
  const arcs = SEGMENTS.map((segment) => {
    const share = pct(values[segment.key]);
    const arc = { ...segment, share, dash: share * circumference, offset };
    offset += share * circumference;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-sunken)" strokeWidth="12" />
          {arcs.map((arc) =>
            arc.share > 0 ? (
              <circle
                key={arc.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth="12"
                strokeLinecap="butt"
                strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                strokeDashoffset={-arc.offset}
              />
            ) : null,
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="figure text-[1.75rem] font-bold leading-none tracking-tight">{total > 0 ? `${codedPct}%` : "—"}</span>
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">coded</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-3">
        {arcs.map((arc) => (
          <li key={arc.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: arc.color }} />
              <span className="font-medium text-ink-2">{arc.label}</span>
            </span>
            <span className="figure font-bold">{values[arc.key].toLocaleString("en-AU")}</span>
          </li>
        ))}
        <li className="mt-1 flex items-center justify-between border-t border-rule-soft pt-3 text-sm">
          <span className="font-medium text-ink-2">All transactions</span>
          <span className="figure font-bold">{total.toLocaleString("en-AU")}</span>
        </li>
      </ul>
    </div>
  );
}

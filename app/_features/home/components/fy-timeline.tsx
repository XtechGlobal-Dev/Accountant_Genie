import { cx } from "@/ui/styles";

/**
 * Where today sits in the Australian financial year.
 *
 * One bar, 1 July to 30 June: the four BAS quarters labelled above it, the
 * months below, the elapsed part filled and a pin at today. Pure render:
 * the page passes the dates in, so the FY arithmetic stays in `au/fy.ts`.
 */

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export function FyTimeline({
  fy,
  start,
  end,
  today,
  quarter,
}: {
  fy: number;
  /** 1 July. */
  start: Date;
  /** Exclusive — the following 1 July. */
  end: Date;
  today: Date;
  quarter: 1 | 2 | 3 | 4;
}) {
  const span = end.getTime() - start.getTime();
  const elapsed = Math.min(Math.max(today.getTime() - start.getTime(), 0), span);
  const pct = (elapsed / span) * 100;

  return (
    <div className="card px-6 py-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 text-[13px]">
        <p className="font-semibold">
          <span className="figure">FY{fy}</span>
          <span className="ml-2 font-normal text-ink-2">1 July {fy - 1} – 30 June {fy}</span>
        </p>
        <p className="text-ink-2">
          Now in <span className="font-bold text-accent-ink">Q{quarter}</span>
          <span className="figure ml-2 text-ink-3">{Math.round(pct)}% of the year elapsed</span>
        </p>
      </div>

      <div className="grid grid-cols-4 text-[14px] font-bold">
        {[1, 2, 3, 4].map((q) => (
          <span key={q} className={cx(q === quarter ? "text-accent" : "text-ink-3")}>
            Q{q}
          </span>
        ))}
      </div>

      <div className="relative mt-6 h-1 rounded-full bg-sunken">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 0.5)}%` }} />
        <span
          aria-hidden="true"
          className="absolute -top-5 -translate-x-1/2 text-accent"
          style={{ left: `${pct}%` }}
        >
          <svg viewBox="0 0 24 24" className="size-5 drop-shadow-sm" fill="currentColor" aria-hidden="true">
            <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
          </svg>
        </span>
        {[25, 50, 75].map((mark) => (
          <span key={mark} aria-hidden="true" className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-rule-strong" style={{ left: `${mark}%` }} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-12 text-[12px] text-ink-3">
        {MONTHS.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
    </div>
  );
}

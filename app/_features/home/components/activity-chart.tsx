/**
 * The firm's year at a glance: transactions per month of the financial year
 * — imported, coded, reviewed — beside how much of the year has elapsed.
 * Pure render: the page passes the counts in.
 */

import type { MonthlyActivity } from "@/shared/contracts/dashboard";
import { cx } from "@/ui/styles";

const SERIES = [
  { key: "imported", label: "Imported", color: "bg-accent-2/60" },
  { key: "coded", label: "Coded", color: "bg-accent" },
  { key: "reviewed", label: "Reviewed", color: "bg-[#1e3a8a]" },
] as const;

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 2 ? 0.5 : scaled <= 5 ? 1 : 2;
  return Math.ceil(scaled / step) * step * magnitude;
}

export function ActivityChart({
  fy,
  months,
  elapsedPct,
  quarter,
}: {
  fy: number;
  months: MonthlyActivity[];
  elapsedPct: number;
  quarter: 1 | 2 | 3 | 4;
}) {
  const max = niceMax(Math.max(1, ...months.map((m) => m.imported)));
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const elapsed = Math.min(100, Math.max(0, elapsedPct));

  return (
    <div className="card flex flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-bold">
          <span className="figure text-lg">FY{fy}</span>
          <span className="ml-2 text-sm font-medium text-ink-2">1 July {fy - 1} – 30 June {fy}</span>
        </p>
        <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-rule px-3 text-[13px] font-semibold text-ink-2">
          This year
        </span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_15rem]">
        <div>
          <ul className="flex flex-wrap items-center justify-end gap-4 text-[12px] font-medium text-ink-2">
            {SERIES.map((series) => (
              <li key={series.key} className="flex items-center gap-1.5">
                <span className={cx("size-2.5 rounded-full", series.color)} />
                {series.label}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-[2rem_1fr] gap-2">
            <div className="figure flex h-44 flex-col justify-between text-[11px] text-ink-3">
              {ticks.map((tick) => (
                <span key={tick} className="leading-none">
                  {Number.isInteger(tick) ? tick : tick.toFixed(1)}
                </span>
              ))}
            </div>
            <div className="relative h-44">
              {ticks.map((tick, index) => (
                <span
                  key={tick}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-dashed border-rule"
                  style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 grid grid-cols-12 items-end gap-2">
                {months.map((month) => (
                  <div key={month.label} className="flex h-full items-end justify-center gap-[3px]">
                    {SERIES.map((series) => {
                      const value = month[series.key];
                      const height = (value / max) * 100;
                      return (
                        <span
                          key={series.key}
                          title={`${month.label}: ${value} ${series.label.toLowerCase()}`}
                          className={cx("w-2 rounded-t-sm transition-[height] duration-500", series.color)}
                          style={{ height: `${Math.max(height, value > 0 ? 3 : 1.5)}%` }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[2rem_1fr] gap-2">
            <span />
            <div className="grid grid-cols-12 gap-2 text-center text-[11px] font-medium text-ink-3">
              {months.map((month) => (
                <span key={month.label}>{month.label}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl bg-accent-soft/70 p-5">
          <div>
            <p className="text-[13px] font-semibold text-ink-2">
              Now in <span className="text-accent-ink">Q{quarter}</span>
            </p>
            <p className="figure mt-1 text-[2rem] font-bold leading-none tracking-tight">{Math.round(elapsed)}%</p>
            <p className="mt-1 text-[12px] text-ink-2">of the year elapsed</p>
          </div>
          <div className="relative ml-auto size-24 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90">
              <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-surface)" strokeWidth="11" />
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${(elapsed / 100) * circumference} ${circumference}`}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

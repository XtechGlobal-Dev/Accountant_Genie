"use client";

/**
 * Choose the period a report covers: a financial year, one of its BAS
 * quarters, or a month. The choice lives in the URL so a report can be
 * bookmarked, shared and printed exactly as seen.
 */

import { useRouter } from "next/navigation";
import { Select, cx } from "@/ui/primitives";

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export interface PeriodChoice {
  kind: "fy" | "quarter" | "month";
  fy: number;
  quarter: 1 | 2 | 3 | 4 | null;
  month: number | null;
}

function hrefFor(basePath: string, choice: PeriodChoice): string {
  const params = new URLSearchParams({ fy: String(choice.fy) });
  if (choice.kind === "quarter" && choice.quarter) params.set("q", String(choice.quarter));
  if (choice.kind === "month" && choice.month !== null) params.set("m", String(choice.month));
  return `${basePath}?${params.toString()}`;
}

export function PeriodPicker({
  basePath,
  period,
  financialYears,
}: {
  basePath: string;
  period: PeriodChoice;
  financialYears: readonly number[];
}) {
  const router = useRouter();
  const go = (choice: PeriodChoice) => router.push(hrefFor(basePath, choice));

  const segment = (label: string, active: boolean, choice: PeriodChoice) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={() => go(choice)}
      className={cx(
        "inline-flex h-full items-center rounded-lg px-3 text-sm transition-colors",
        active ? "bg-surface font-semibold text-ink shadow-xs" : "text-ink-2 hover:text-ink",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        name="fy"
        aria-label="Financial year"
        value={String(period.fy)}
        onChange={(event) =>
          go({ ...period, fy: Number(event.target.value) })
        }
        className="w-32"
      >
        {financialYears.map((fy) => (
          <option key={fy} value={fy}>
            FY{fy}
          </option>
        ))}
      </Select>

      <div
        role="group"
        aria-label="Period"
        className="inline-flex h-11 items-center gap-0.5 rounded-xl border border-rule bg-sunken p-1 shadow-xs"
      >
        {segment("Full year", period.kind === "fy", {
          kind: "fy",
          fy: period.fy,
          quarter: null,
          month: null,
        })}
        {([1, 2, 3, 4] as const).map((q) =>
          segment(`Q${q}`, period.kind === "quarter" && period.quarter === q, {
            kind: "quarter",
            fy: period.fy,
            quarter: q,
            month: null,
          }),
        )}
      </div>

      <Select
        name="month"
        aria-label="Month"
        value={period.kind === "month" && period.month !== null ? String(period.month) : ""}
        onChange={(event) => {
          if (event.target.value === "") return;
          go({ kind: "month", fy: period.fy, quarter: null, month: Number(event.target.value) });
        }}
        className="w-36"
      >
        <option value="">Month…</option>
        {MONTHS.map((month, index) => (
          <option key={month} value={index}>
            {month} {index <= 5 ? period.fy - 1 : period.fy}
          </option>
        ))}
      </Select>
    </div>
  );
}

import {
  currentFinancialYear,
  financialYearRange,
  monthRange,
  quarterOf,
  quarterRange,
  type Quarter,
} from "@/server/au/fy";
import type { ReportPeriod } from "@/shared/contracts/report";

/**
 * A report period from URL search params.
 *
 * `?fy=2026` is the whole year, `?fy=2026&q=1` a BAS quarter, `?fy=2026&m=3`
 * a month (0–11 counting from July). Anything unparseable falls back to the
 * current quarter rather than erroring: a mistyped URL should show a report,
 * not a stack trace.
 */

export interface PeriodParams {
  fy?: string | undefined;
  q?: string | undefined;
  m?: string | undefined;
}

const EARLIEST_FY = 2000;

function parseInt(value: string | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  return Number(value);
}

export function resolvePeriod(params: PeriodParams, now = new Date()): ReportPeriod {
  const currentFy = currentFinancialYear(now);
  const requestedFy = parseInt(params.fy);
  const fy =
    requestedFy !== null && requestedFy >= EARLIEST_FY && requestedFy <= currentFy + 1
      ? requestedFy
      : currentFy;

  const month = parseInt(params.m);
  if (month !== null && month >= 0 && month <= 11) {
    const range = monthRange(fy, month);
    return { kind: "month", fy, quarter: null, month, ...range };
  }

  const quarter = parseInt(params.q);
  if (quarter !== null && quarter >= 1 && quarter <= 4) {
    const range = quarterRange(fy, quarter as Quarter);
    return { kind: "quarter", fy, quarter: quarter as Quarter, month: null, ...range };
  }

  if (params.fy && quarter === null && month === null) {
    const range = financialYearRange(fy);
    return { kind: "fy", fy, quarter: null, month: null, ...range };
  }

  // Nothing chosen: the quarter the firm is most likely working on.
  const defaultQuarter = quarterOf(now);
  const range = quarterRange(currentFy, defaultQuarter);
  return { kind: "quarter", fy: currentFy, quarter: defaultQuarter, month: null, ...range };
}

/** The search string that reproduces a period, for links. */
export function periodQuery(period: Pick<ReportPeriod, "kind" | "fy" | "quarter" | "month">): string {
  const params = new URLSearchParams({ fy: String(period.fy) });
  if (period.kind === "quarter" && period.quarter) params.set("q", String(period.quarter));
  if (period.kind === "month" && period.month !== null) params.set("m", String(period.month));
  return `?${params.toString()}`;
}

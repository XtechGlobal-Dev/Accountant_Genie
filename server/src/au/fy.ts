/**
 * Australian financial year helpers.
 *
 * The AU financial year runs 1 July → 30 June. By convention "FY2026" is the
 * year ENDING 30 June 2026, i.e. 1 Jul 2025 → 30 Jun 2026.
 *
 * All ranges are half-open [start, end) in UTC so that Postgres range queries
 * and JS date comparison agree regardless of the server's local timezone.
 */

export interface DateRange {
  start: Date;
  end: Date; // exclusive
  label: string;
}

/** The FY label (year ending) that a given date falls into. */
export function financialYearOf(date: Date): number {
  const y = date.getUTCFullYear();
  // Months are 0-indexed: 6 === July
  return date.getUTCMonth() >= 6 ? y + 1 : y;
}

/** Full-year range for FY ending 30 June `fy`. */
export function financialYearRange(fy: number): DateRange {
  return {
    start: new Date(Date.UTC(fy - 1, 6, 1)),
    end: new Date(Date.UTC(fy, 6, 1)),
    label: `FY${fy}`,
  };
}

export type Quarter = 1 | 2 | 3 | 4;

/**
 * BAS quarters within an AU financial year:
 *   Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun.
 */
export function quarterRange(fy: number, quarter: Quarter): DateRange {
  // Q1 starts July of the prior calendar year.
  const startMonth = [6, 9, 0, 3][quarter - 1];
  const startYear = quarter <= 2 ? fy - 1 : fy;
  const start = new Date(Date.UTC(startYear, startMonth, 1));
  const end = new Date(Date.UTC(startYear, startMonth + 3, 1));
  return { start, end, label: `FY${fy} Q${quarter}` };
}

export function monthRange(fy: number, monthIndex: number): DateRange {
  // monthIndex 0..11 counting from July
  const startYear = monthIndex <= 5 ? fy - 1 : fy;
  const startMonth = (6 + monthIndex) % 12;
  const start = new Date(Date.UTC(startYear, startMonth, 1));
  const end = new Date(Date.UTC(startYear, startMonth + 1, 1));
  const label = start.toLocaleString("en-AU", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start, end, label };
}

/** The current FY based on today's date. */
export function currentFinancialYear(now = new Date()): number {
  return financialYearOf(now);
}

/** A descending list of FY labels for pickers. */
export function recentFinancialYears(count = 5, now = new Date()): number[] {
  const current = currentFinancialYear(now);
  return Array.from({ length: count }, (_, i) => current - i);
}

export function quarterOf(date: Date): Quarter {
  const m = date.getUTCMonth();
  if (m >= 6 && m <= 8) return 1;
  if (m >= 9 && m <= 11) return 2;
  if (m >= 0 && m <= 2) return 3;
  return 4;
}

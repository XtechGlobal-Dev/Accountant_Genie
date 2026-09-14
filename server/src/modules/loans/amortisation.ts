import type { LoanSchedule, LoanScheduleRow } from "@/shared/contracts/register";
import type { LoanFrequency } from "@/shared/enums";

/**
 * A loan's repayment schedule — pure, integer cents.
 *
 * Interest for a period is the opening balance × the periodic rate (the annual
 * rate in basis points divided by the number of periods in a year), rounded
 * to the cent. The rest of the repayment reduces principal. This is the
 * standard split a lender's statement shows; it is what lets a repayment be
 * coded as principal (BAS excluded) and interest (input taxed) rather than
 * expensed whole.
 */

export interface LoanTerms {
  principalCents: number;
  /** Annual rate in basis points: 725 = 7.25% p.a. */
  interestRateBasisPoints: number;
  startDate: Date;
  termMonths: number;
  repaymentCents: number;
  frequency: LoanFrequency;
}

const PERIODS_PER_YEAR: Record<LoanFrequency, number> = { WEEKLY: 52, FORTNIGHTLY: 26, MONTHLY: 12 };

function roundCents(value: number): number {
  const magnitude = Math.round(Math.abs(value));
  return value < 0 ? -magnitude : magnitude;
}

function periodDate(start: Date, frequency: LoanFrequency, period: number): Date {
  if (frequency === "MONTHLY") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + period, start.getUTCDate()));
  }
  const days = frequency === "WEEKLY" ? 7 : 14;
  return new Date(start.getTime() + period * days * 86_400_000);
}

export function periodCount(terms: Pick<LoanTerms, "termMonths" | "frequency">): number {
  return Math.max(1, Math.round((terms.termMonths * PERIODS_PER_YEAR[terms.frequency]) / 12));
}

/** The whole schedule, plus the balance outstanding as at a date. */
export function loanSchedule(terms: LoanTerms, asAt: Date): LoanSchedule {
  const periods = periodCount(terms);
  const periodicRate = terms.interestRateBasisPoints / 10_000 / PERIODS_PER_YEAR[terms.frequency];
  const rows: LoanScheduleRow[] = [];

  let opening = terms.principalCents;
  for (let period = 1; period <= periods && opening > 0; period += 1) {
    const interestCents = roundCents(opening * periodicRate);
    const repaymentCents = Math.min(terms.repaymentCents, opening + interestCents);
    const principalCents = repaymentCents - interestCents;
    const closing = opening - principalCents;
    rows.push({
      period,
      date: periodDate(terms.startDate, terms.frequency, period),
      openingCents: opening,
      interestCents,
      principalCents,
      repaymentCents,
      closingCents: closing,
    });
    opening = closing;
  }

  const balloonCents = opening > 0 ? opening : 0;
  const lastBefore = rows.filter((row) => row.date <= asAt).at(-1);
  const balanceAtCents =
    asAt < terms.startDate ? 0 : lastBefore ? lastBefore.closingCents : terms.principalCents;

  return {
    rows,
    totalInterestCents: rows.reduce((s, r) => s + r.interestCents, 0),
    totalPrincipalCents: rows.reduce((s, r) => s + r.principalCents, 0),
    balloonCents,
    balanceAtCents,
  };
}

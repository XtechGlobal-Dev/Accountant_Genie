import { describe, expect, it } from "vitest";
import { loanSchedule, periodCount, type LoanTerms } from "./amortisation";

const terms: LoanTerms = {
  principalCents: 1_200_000, // $12,000
  interestRateBasisPoints: 1_200, // 12% p.a. → 1% a month
  startDate: new Date("2026-07-01T00:00:00.000Z"),
  termMonths: 12,
  repaymentCents: 106_619, // clears a $12,000 12% loan in 12 months
  frequency: "MONTHLY",
};

describe("loanSchedule", () => {
  it("splits each repayment into interest on the opening balance and principal", () => {
    const schedule = loanSchedule(terms, new Date("2027-07-01T00:00:00.000Z"));
    const first = schedule.rows[0]!;
    expect(first.interestCents).toBe(12_000);
    expect(first.principalCents).toBe(106_619 - 12_000);
    expect(first.closingCents).toBe(1_200_000 - (106_619 - 12_000));
    expect(first.date.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("clears the loan inside its term with no balloon, and never over-repays", () => {
    const schedule = loanSchedule(terms, new Date("2027-07-01T00:00:00.000Z"));
    expect(schedule.rows.length).toBeLessThanOrEqual(12);
    expect(schedule.balloonCents).toBe(0);
    expect(schedule.rows.at(-1)!.closingCents).toBe(0);
    expect(schedule.totalPrincipalCents).toBe(1_200_000);
    expect(schedule.rows.at(-1)!.repaymentCents).toBeLessThanOrEqual(106_619);
  });

  it("reports a balloon when the repayment does not clear the loan", () => {
    const schedule = loanSchedule({ ...terms, repaymentCents: 50_000 }, new Date("2027-07-01T00:00:00.000Z"));
    expect(schedule.rows).toHaveLength(12);
    expect(schedule.balloonCents).toBeGreaterThan(0);
  });

  it("gives the balance as at a date", () => {
    const beforeStart = loanSchedule(terms, new Date("2026-06-01T00:00:00.000Z"));
    expect(beforeStart.balanceAtCents).toBe(0);
    const afterTwo = loanSchedule(terms, new Date("2026-09-15T00:00:00.000Z"));
    expect(afterTwo.balanceAtCents).toBe(afterTwo.rows[1]!.closingCents);
  });

  it("converts the term into periods for each frequency", () => {
    expect(periodCount({ termMonths: 12, frequency: "MONTHLY" })).toBe(12);
    expect(periodCount({ termMonths: 12, frequency: "FORTNIGHTLY" })).toBe(26);
    expect(periodCount({ termMonths: 6, frequency: "WEEKLY" })).toBe(26);
  });
});

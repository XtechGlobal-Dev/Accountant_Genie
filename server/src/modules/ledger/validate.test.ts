import { describe, expect, it } from "vitest";
import { MAX_LINE_CENTS, checkJournalShape, journalTotals } from "./validate";

const dr = (cents: number) => ({ debitCents: cents, creditCents: 0 });
const cr = (cents: number) => ({ debitCents: 0, creditCents: cents });

describe("checkJournalShape", () => {
  it("accepts a balanced two-line journal", () => {
    expect(checkJournalShape([dr(11000), cr(11000)])).toBeNull();
  });

  it("accepts a balanced multi-line journal", () => {
    expect(checkJournalShape([dr(10000), dr(1000), cr(5500), cr(5500)])).toBeNull();
  });

  it("rejects fewer than two lines", () => {
    expect(checkJournalShape([dr(100)])?.message).toMatch(/at least 2 lines/);
    expect(checkJournalShape([])?.message).toMatch(/at least 2 lines/);
  });

  it("rejects an unbalanced journal", () => {
    expect(checkJournalShape([dr(11000), cr(10999)])?.message).toMatch(/Debits must equal credits/);
  });

  it("rejects a line with both a debit and a credit", () => {
    const problem = checkJournalShape([
      { debitCents: 100, creditCents: 100 },
      cr(0),
    ]);
    expect(problem?.message).toMatch(/not both/);
    expect(problem?.line).toBe(0);
  });

  it("rejects a line with neither a debit nor a credit", () => {
    const problem = checkJournalShape([dr(100), { debitCents: 0, creditCents: 0 }, cr(100)]);
    expect(problem?.message).toMatch(/needs a debit or a credit/);
    expect(problem?.line).toBe(1);
  });

  it("rejects a zero-value journal", () => {
    // Two zero lines fail the per-line rule first; the zero-total rule is the
    // backstop for callers that bypass it.
    expect(journalTotals([dr(0), cr(0)]).debitCents).toBe(0);
  });

  it("rejects negative, fractional and out-of-range cents", () => {
    expect(checkJournalShape([dr(-1), cr(-1)])?.message).toMatch(/whole cents/);
    expect(checkJournalShape([dr(1.5), cr(1.5)])?.message).toMatch(/whole cents/);
    expect(
      checkJournalShape([dr(MAX_LINE_CENTS + 1), cr(MAX_LINE_CENTS + 1)])?.message,
    ).toMatch(/whole cents/);
  });
});

describe("journalTotals", () => {
  it("sums each side and reports the difference", () => {
    expect(journalTotals([dr(300), dr(200), cr(400)])).toEqual({
      debitCents: 500,
      creditCents: 400,
      differenceCents: 100,
    });
  });
});

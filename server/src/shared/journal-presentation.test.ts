import { describe, expect, it } from "vitest";
import { presentJournal } from "./journal-presentation";

/**
 * What the journals table shows must add up to what was posted: the net
 * plus the GST line equals the gross on each side, so debits still equal
 * credits on the page exactly as they do in the ledger.
 */

const office = { accountCode: 450, accountName: "Office Supplies", debitCents: 55_000, creditCents: 0, gstCents: 5_000, gstTreatment: "GST_ON_EXPENSES" as const };
const bankOut = { accountCode: 701, accountName: "Business Bank", debitCents: 0, creditCents: 55_000, gstCents: 0, gstTreatment: "BAS_EXCLUDED" as const };

describe("presentJournal", () => {
  it("splits a gross expense into its net and a GST Receivable debit", () => {
    expect(presentJournal([office, bankOut])).toEqual({
      debits: [
        { accountCode: 450, accountName: "Office Supplies", cents: 50_000, isGst: false },
        { accountCode: null, accountName: "GST Receivable", cents: 5_000, isGst: true },
      ],
      credits: [{ accountCode: 701, accountName: "Business Bank", cents: 55_000, isGst: false }],
    });
  });

  it("splits a gross sale into its net and a GST Payable credit", () => {
    const sales = { accountCode: 200, accountName: "Sales", debitCents: 0, creditCents: 1_100_000, gstCents: 100_000, gstTreatment: "GST_ON_INCOME" as const };
    const bankIn = { ...bankOut, debitCents: 1_100_000, creditCents: 0 };
    expect(presentJournal([sales, bankIn])).toEqual({
      debits: [{ accountCode: 701, accountName: "Business Bank", cents: 1_100_000, isGst: false }],
      credits: [
        { accountCode: 200, accountName: "Sales", cents: 1_000_000, isGst: false },
        { accountCode: null, accountName: "GST Payable", cents: 100_000, isGst: true },
      ],
    });
  });

  it("leaves a GST-free, excluded or opening line whole", () => {
    const rent = { accountCode: 480, accountName: "Rent Expense", debitCents: 200_000, creditCents: 0, gstCents: 0, gstTreatment: "GST_FREE_EXPENSES" as const };
    const wages = { accountCode: 600, accountName: "Wages & Salaries", debitCents: 250_000, creditCents: 0, gstCents: 0, gstTreatment: "BAS_EXCLUDED" as const };
    const { debits } = presentJournal([rent, wages]);
    expect(debits).toEqual([
      { accountCode: 480, accountName: "Rent Expense", cents: 200_000, isGst: false },
      { accountCode: 600, accountName: "Wages & Salaries", cents: 250_000, isGst: false },
    ]);
  });

  it("puts a refund's GST on the credit side with the refund", () => {
    // A credit to an expense account: the posting engine stored negative GST.
    const refund = { ...office, debitCents: 0, creditCents: 55_000, gstCents: -5_000 };
    const { credits } = presentJournal([refund]);
    expect(credits).toEqual([
      { accountCode: 450, accountName: "Office Supplies", cents: 50_000, isGst: false },
      { accountCode: null, accountName: "GST Receivable", cents: 5_000, isGst: true },
    ]);
  });

  it("keeps each side's total equal to the gross posted", () => {
    const { debits, credits } = presentJournal([office, bankOut]);
    const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
    expect(sum(debits)).toBe(55_000);
    expect(sum(credits)).toBe(55_000);
  });
});

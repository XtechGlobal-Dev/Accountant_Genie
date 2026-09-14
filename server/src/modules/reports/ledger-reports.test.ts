import { describe, expect, it } from "vitest";
import type { AccountType, GstTreatment } from "@/shared/enums";
import type { LedgerLine } from "./aggregate";
import { balanceSheet, generalLedger, trialBalance } from "./ledger-reports";

let n = 0;
function line(
  date: string,
  entryId: string,
  overrides: Partial<LedgerLine> & { accountCode: number; accountType: AccountType; gstTreatment: GstTreatment | null },
): LedgerLine {
  n += 1;
  return {
    entryId,
    date: new Date(`${date}T00:00:00.000Z`),
    reference: null,
    entryDescription: null,
    lineDescription: null,
    accountId: `a${overrides.accountCode}`,
    accountName: `Account ${overrides.accountCode}`,
    debitCents: 0,
    creditCents: 0,
    gstCents: 0,
    ...overrides,
  };
}

const FY_START = new Date("2026-07-01T00:00:00.000Z");
const AS_AT = new Date("2026-10-01T00:00:00.000Z");

// Prior year: opening capital 50,000 into the bank.
// This year: a 11,000 sale (1,000 GST), a 3,300 rent bill (300 GST), a 2,200 capital purchase (200 GST).
const LINES: LedgerLine[] = [
  line("2025-07-01", "open", { accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", debitCents: 5_000_000 }),
  line("2025-07-01", "open", { accountCode: 900, accountType: "EQUITY", gstTreatment: "BAS_EXCLUDED", creditCents: 5_000_000 }),
  line("2025-09-01", "py", { accountCode: 469, accountType: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", debitCents: 110_000, gstCents: 10_000 }),
  line("2025-09-01", "py", { accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 110_000 }),
  line("2026-07-14", "sale", { accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", debitCents: 1_100_000 }),
  line("2026-07-14", "sale", { accountCode: 200, accountType: "INCOME", gstTreatment: "GST_ON_INCOME", creditCents: 1_100_000, gstCents: 100_000 }),
  line("2026-07-31", "rent", { accountCode: 469, accountType: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", debitCents: 330_000, gstCents: 30_000 }),
  line("2026-07-31", "rent", { accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 330_000 }),
  line("2026-08-10", "laptop", { accountCode: 710, accountType: "ASSET", gstTreatment: "GST_ON_CAPITAL", debitCents: 220_000, gstCents: 20_000 }),
  line("2026-08-10", "laptop", { accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 220_000 }),
];

describe("balanceSheet", () => {
  const bs = balanceSheet(LINES, FY_START, AS_AT);

  it("balances: assets equal liabilities plus GST control plus equity and earnings", () => {
    expect(bs.differenceCents).toBe(0);
  });

  it("carries assets net of claimable GST and the GST control as a liability", () => {
    const equipment = bs.assets.find((row) => row.code === 710);
    expect(equipment?.cents).toBe(200_000);
    // 1,000 collected − 300 on rent − 200 on the laptop − 100 on last year's rent
    expect(bs.gstControlCents).toBe(100_000 - 30_000 - 20_000 - 10_000);
  });

  it("splits earnings into prior-year retained and current-year", () => {
    expect(bs.retainedEarningsCents).toBe(-100_000);
    expect(bs.currentEarningsCents).toBe(1_000_000 - 300_000);
    expect(bs.totalEquityCents).toBe(5_000_000 - 100_000 + 700_000);
  });
});

describe("trialBalance", () => {
  it("sums to zero on gross postings", () => {
    const tb = trialBalance(LINES, AS_AT);
    expect(tb.differenceCents).toBe(0);
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    expect(tb.lines.find((l) => l.code === 900)?.creditCents).toBe(5_000_000);
    expect(tb.lines.find((l) => l.code === 701)?.debitCents).toBe(5_000_000 - 110_000 + 1_100_000 - 330_000 - 220_000);
  });
});

describe("generalLedger", () => {
  it("brings balances forward and runs them through the period", () => {
    const gl = generalLedger(LINES, FY_START);
    const bank = gl.accounts.find((a) => a.code === 701)!;
    expect(bank.openingCents).toBe(5_000_000 - 110_000);
    expect(bank.entries.map((e) => e.balanceCents)).toEqual([
      4_890_000 + 1_100_000,
      4_890_000 + 1_100_000 - 330_000,
      4_890_000 + 1_100_000 - 330_000 - 220_000,
    ]);
    expect(bank.closingCents).toBe(bank.entries.at(-1)!.balanceCents);
    // Prior-year-only accounts with a zero opening are dropped; equity keeps its opening.
    expect(gl.accounts.find((a) => a.code === 900)?.openingCents).toBe(-5_000_000);
    expect(gl.lineCount).toBe(6);
  });
});

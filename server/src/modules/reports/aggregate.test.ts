import { describe, expect, it } from "vitest";
import type { AccountType, GstTreatment } from "@/shared/enums";
import { profitAndLoss, simpleBas, type LedgerLine } from "./aggregate";

let counter = 0;

function line(
  overrides: Partial<LedgerLine> & {
    accountCode: number;
    accountType: AccountType;
    gstTreatment: GstTreatment | null;
  },
): LedgerLine {
  counter += 1;
  return {
    entryId: `e${counter}`,
    date: new Date(Date.UTC(2025, 7, 1)),
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

// A registered client: $11,000 of sales, $3,300 of rent, $15 of bank fees,
// $2,200 of wages, and the bank side of each — the way the posting engine
// would have written them.
const SALE = line({ accountCode: 200, accountType: "INCOME", gstTreatment: "GST_ON_INCOME", creditCents: 1_100_000, gstCents: 100_000 });
const SALE_BANK = line({ accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", debitCents: 1_100_000 });
const RENT = line({ accountCode: 469, accountType: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", debitCents: 330_000, gstCents: 30_000 });
const RENT_BANK = line({ accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 330_000 });
const FEES = line({ accountCode: 404, accountType: "EXPENSE", gstTreatment: "INPUT_TAXED", debitCents: 1_500 });
const FEES_BANK = line({ accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 1_500 });
const WAGES = line({ accountCode: 477, accountType: "EXPENSE", gstTreatment: "BAS_EXCLUDED", debitCents: 220_000 });
const PAYG = line({ accountCode: 825, accountType: "LIABILITY", gstTreatment: "BAS_EXCLUDED", creditCents: 50_000 });
const WAGES_BANK = line({ accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 170_000 });
const COGS = line({ accountCode: 310, accountType: "COGS", gstTreatment: "GST_ON_EXPENSES", debitCents: 110_000, gstCents: 10_000 });
const COGS_BANK = line({ accountCode: 701, accountType: "ASSET", gstTreatment: "BAS_EXCLUDED", creditCents: 110_000 });

const LINES = [SALE, SALE_BANK, RENT, RENT_BANK, FEES, FEES_BANK, WAGES, PAYG, WAGES_BANK, COGS, COGS_BANK];

describe("profitAndLoss", () => {
  it("reports income and expenses net of GST and ignores balance sheet lines", () => {
    const pl = profitAndLoss(LINES);
    expect(pl.totalIncomeCents).toBe(1_000_000);
    expect(pl.totalCogsCents).toBe(100_000);
    expect(pl.grossProfitCents).toBe(900_000);
    // Rent net 3,000 + fees 15 + wages 2,200
    expect(pl.totalExpensesCents).toBe(300_000 + 1_500 + 220_000);
    expect(pl.netProfitCents).toBe(900_000 - 521_500);
    expect(pl.lineCount).toBe(LINES.length);
  });

  it("groups by account, sorted by code, dropping zero rows", () => {
    const refund = line({ accountCode: 200, accountType: "INCOME", gstTreatment: "GST_ON_INCOME", debitCents: 1_100_000, gstCents: -100_000 });
    const pl = profitAndLoss([SALE, refund, RENT, FEES]);
    // Sale and its full refund cancel to zero and disappear.
    expect(pl.income).toEqual([]);
    expect(pl.expenses.map((row) => row.code)).toEqual([404, 469]);
  });

  it("is empty for an empty ledger", () => {
    const pl = profitAndLoss([]);
    expect(pl.netProfitCents).toBe(0);
    expect(pl.lineCount).toBe(0);
  });
});

describe("simpleBas", () => {
  const accounts = { wagesCodes: [325, 477], paygWithholdingCode: 825 };

  it("maps each treatment to its labels and sums the posted GST", () => {
    const bas = simpleBas(LINES, accounts);
    expect(bas.figures.G1.cents).toBe(1_100_000);
    expect(bas.figures["1A"].cents).toBe(100_000);
    // Rent + COGS, gross; bank fees are input taxed and stay off G11.
    expect(bas.figures.G11.cents).toBe(330_000 + 110_000);
    expect(bas.figures["1B"].cents).toBe(30_000 + 10_000);
    expect(bas.figures.G10.cents).toBe(0);
    expect(bas.netGstCents).toBe(60_000);
  });

  it("derives W1 from wages accounts and W2 from PAYG withholding", () => {
    const bas = simpleBas(LINES, accounts);
    expect(bas.figures.W1.cents).toBe(220_000);
    expect(bas.figures.W2.cents).toBe(50_000);
  });

  it("nets a refund off the label it came from", () => {
    const refund = line({ accountCode: 200, accountType: "INCOME", gstTreatment: "GST_ON_INCOME", debitCents: 110_000, gstCents: -10_000 });
    const bas = simpleBas([SALE, refund], accounts);
    expect(bas.figures.G1.cents).toBe(990_000);
    expect(bas.figures["1A"].cents).toBe(90_000);
  });

  it("keeps the lineage: every contributing line is listed against its label", () => {
    const bas = simpleBas(LINES, accounts);
    expect(bas.figures["1A"].contributors).toHaveLength(1);
    expect(bas.figures["1A"].contributors[0]?.entryId).toBe(SALE.entryId);
    expect(bas.figures.G11.contributors.map((c) => c.accountCode)).toEqual([469, 310]);
    expect(bas.figures["1A"].contributors.reduce((s, c) => s + c.cents, 0)).toBe(
      bas.figures["1A"].cents,
    );
  });

  it("counts unresolved lines instead of guessing a label for them", () => {
    const unknown = line({ accountCode: 0, accountType: "UNKNOWN", gstTreatment: "UNALLOCATED", debitCents: 500 });
    const untagged = line({ accountCode: 200, accountType: "INCOME", gstTreatment: null, creditCents: 500 });
    const bas = simpleBas([SALE, unknown, untagged], accounts);
    expect(bas.unresolvedCount).toBe(2);
    expect(bas.figures.G1.cents).toBe(1_100_000);
  });
});

import { describe, expect, it } from "vitest";
import type { AccountType, GstTreatment } from "@/shared/enums";
import { profitAndLoss, simpleBas, tpar, transactionsReport, type LedgerLine } from "./aggregate";

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
  const accounts = { wagesCodes: [325, 477], paygWithholdingCode: 825, inputTaxed: { salesAtG1: false, purchasesAtG11: false } };

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

describe("simpleBas — input-taxed supplies", () => {
  const withRule = { wagesCodes: [325, 477], paygWithholdingCode: 825, inputTaxed: { salesAtG1: true, purchasesAtG11: true } };
  const withoutRule = { wagesCodes: [325, 477], paygWithholdingCode: 825, inputTaxed: { salesAtG1: false, purchasesAtG11: false } };
  const INTEREST = line({ accountCode: 202, accountType: "INCOME", gstTreatment: "INPUT_TAXED", creditCents: 4_200 });

  it("leaves input-taxed lines out of every label until the rule is verified, and counts them", () => {
    const bas = simpleBas([SALE, FEES, INTEREST], withoutRule);
    expect(bas.figures.G1.cents).toBe(1_100_000);
    expect(bas.figures.G11.cents).toBe(0);
    expect(bas.inputTaxedOmittedCount).toBe(2);
    // 1A / 1B never see input-taxed lines either way.
    expect(bas.figures["1A"].cents).toBe(100_000);
    expect(bas.figures["1B"].cents).toBe(0);
  });

  it("counts input-taxed sales at G1 and purchases at G11 once the rule says so, with no GST", () => {
    const bas = simpleBas([SALE, FEES, INTEREST], withRule);
    expect(bas.figures.G1.cents).toBe(1_100_000 + 4_200);
    expect(bas.figures.G11.cents).toBe(1_500);
    expect(bas.figures["1A"].cents).toBe(100_000);
    expect(bas.figures["1B"].cents).toBe(0);
    expect(bas.inputTaxedOmittedCount).toBe(0);
  });
});

describe("transactionsReport", () => {
  const bankSide = [701, 804];
  const fromBank = (l: LedgerLine): LedgerLine => ({ ...l, entrySource: "BANK" });
  const manual = (l: LedgerLine): LedgerLine => ({ ...l, entrySource: "MANUAL" });

  it("sums accepted bank postings per account, leaving the bank side out", () => {
    const report = transactionsReport([SALE, SALE_BANK, RENT, RENT_BANK].map(fromBank), bankSide);
    expect(report.accounts.map((a) => a.code)).toEqual([200, 469]);
    const sales = report.accounts[0]!;
    expect(sales.count).toBe(1);
    expect(sales.grossCents).toBe(1_100_000);
    expect(sales.gstCents).toBe(100_000);
    expect(sales.netCents).toBe(1_000_000);
    expect(report.totalGrossCents).toBe(1_100_000 + 330_000);
    expect(report.totalGstCents).toBe(130_000);
    expect(report.lineCount).toBe(2);
  });

  it("ignores manual journals — only bank-sourced entries are transactions", () => {
    const report = transactionsReport([manual(SALE), manual(SALE_BANK), fromBank(RENT), fromBank(RENT_BANK)], bankSide);
    expect(report.accounts.map((a) => a.code)).toEqual([469]);
    expect(report.totalCount).toBe(1);
  });
});

describe("tpar", () => {
  const paid = (subcontractorId: string | null, cents: number, gst: number, name = "Sub") => ({
    debitCents: cents,
    creditCents: 0,
    gstCents: gst,
    subcontractorId,
    subcontractor: subcontractorId ? { name: `${name} ${subcontractorId}`, abn: null } : null,
  });

  it("groups gross and GST per subcontractor and counts what is unlinked separately", () => {
    const report = tpar([paid("s1", 110_000, 10_000), paid("s1", 55_000, 5_000), paid("s2", 22_000, 2_000), paid(null, 33_000, 3_000)], 2026, [320], false);
    expect(report.lines.map((l) => [l.subcontractorId, l.grossCents, l.gstCents, l.paymentCount])).toEqual([
      ["s1", 165_000, 15_000, 2],
      ["s2", 22_000, 2_000, 1],
    ]);
    expect(report.totalGrossCents).toBe(187_000);
    expect(report.unlinkedCount).toBe(1);
    expect(report.unlinkedCents).toBe(33_000);
    expect(report.mappingVerified).toBe(false);
    expect(report.accountCodes).toEqual([320]);
  });
});

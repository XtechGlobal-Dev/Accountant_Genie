import { contributesTo, isIncomeCode, isUnresolved } from "@/server/au/gst";
import type { InputTaxedBasLabels } from "@/server/modules/tax-rules/catalogue";
import type { AccountType, GstTreatment, JournalSource } from "@/shared/enums";
import type {
  BasContributor,
  BasFigure,
  BasLabelKey,
  ProfitAndLoss,
  ReportLine,
  SimpleBas,
  TransactionsReport,
  TransactionsReportLine,
} from "@/shared/contracts/report";
import type { TparLine, TparReport } from "@/shared/contracts/register";

/**
 * THE reporting layer. Pure functions over journal lines.
 *
 * Every report in the product is a sum computed here. There is no other place
 * that adds up ledger amounts, so a P&L, a BAS, a TPAR and a trial balance
 * cannot disagree with one another — they are different views of one sum.
 *
 * No I/O, so every rule in this file is covered by a unit test.
 */

/** A journal line with what the reports need to know about its account and entry. */
export interface LedgerLine {
  readonly entryId: string;
  readonly date: Date;
  readonly reference: string | null;
  readonly entryDescription: string | null;
  readonly lineDescription: string | null;
  readonly accountId: string;
  readonly accountCode: number;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly debitCents: number;
  readonly creditCents: number;
  /** Signed from the account's natural side at posting time. */
  readonly gstCents: number;
  readonly gstTreatment: GstTreatment | null;
  /** Where the entry came from: a bank transaction, a manual journal, an opening balance. */
  readonly entrySource?: JournalSource | undefined;
}

/* -------------------------------------------------------------------------- */
/* Profit & Loss                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a line contributes to the P&L: the gross from the account's natural
 * side, less the GST embedded in it. For a registered client the GST is the
 * ATO's money, not income or expense; for an unregistered one every line was
 * posted with zero GST and the gross is the figure.
 */
function netForProfitAndLoss(line: LedgerLine): number {
  const gross =
    line.accountType === "INCOME"
      ? line.creditCents - line.debitCents
      : line.debitCents - line.creditCents;
  return gross - line.gstCents;
}

function sumByAccount(lines: readonly LedgerLine[]): ReportLine[] {
  const totals = new Map<string, ReportLine>();
  for (const line of lines) {
    const existing = totals.get(line.accountId);
    const cents = netForProfitAndLoss(line);
    if (existing) {
      existing.cents += cents;
    } else {
      totals.set(line.accountId, {
        accountId: line.accountId,
        code: line.accountCode,
        name: line.accountName,
        cents,
      });
    }
  }
  return [...totals.values()]
    .filter((row) => row.cents !== 0)
    .sort((a, b) => a.code - b.code);
}

const total = (rows: readonly ReportLine[]) => rows.reduce((sum, row) => sum + row.cents, 0);

export function profitAndLoss(lines: readonly LedgerLine[]): ProfitAndLoss {
  const income = sumByAccount(lines.filter((line) => line.accountType === "INCOME"));
  const cogs = sumByAccount(lines.filter((line) => line.accountType === "COGS"));
  const expenses = sumByAccount(lines.filter((line) => line.accountType === "EXPENSE"));

  const totalIncomeCents = total(income);
  const totalCogsCents = total(cogs);
  const totalExpensesCents = total(expenses);
  const grossProfitCents = totalIncomeCents - totalCogsCents;

  return {
    income,
    cogs,
    expenses,
    totalIncomeCents,
    totalCogsCents,
    grossProfitCents,
    totalExpensesCents,
    netProfitCents: grossProfitCents - totalExpensesCents,
    lineCount: lines.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Simple BAS                                                                 */
/* -------------------------------------------------------------------------- */

const BAS_TITLES: Record<BasLabelKey, string> = {
  G1: "Total sales",
  G10: "Capital purchases",
  G11: "Non-capital purchases",
  "1A": "GST on sales",
  "1B": "GST on purchases",
  W1: "Total salary, wages and other payments",
  W2: "Amounts withheld from W1",
};

export interface BasAccountMap {
  /** Account codes whose postings are wages, reported at W1. */
  readonly wagesCodes: readonly number[];
  /** The PAYG withholding payable account, reported at W2. */
  readonly paygWithholdingCode: number;
  /**
   * Whether input-taxed supplies are counted at G1 (sales) and G11
   * (purchases). From the verified INPUT_TAXED_BAS_LABELS rule; when nothing
   * is verified both are false and input-taxed lines contribute to no label.
   */
  readonly inputTaxed: InputTaxedBasLabels;
}

function contributor(line: LedgerLine, cents: number): BasContributor {
  return {
    entryId: line.entryId,
    date: line.date,
    reference: line.reference,
    description: line.lineDescription ?? line.entryDescription,
    accountCode: line.accountCode,
    accountName: line.accountName,
    cents,
  };
}

/**
 * The gross of a line as the BAS sees it, signed from the treatment's natural
 * side so a refund reduces the label instead of inflating it.
 */
function basGross(treatment: GstTreatment, line: LedgerLine): number {
  return isIncomeCode(treatment)
    ? line.creditCents - line.debitCents
    : line.debitCents - line.creditCents;
}

/** An input-taxed line is a sale on an income account and a purchase on anything else. */
function inputTaxedIsSale(line: LedgerLine): boolean {
  return line.accountType === "INCOME";
}

/**
 * Simple BAS labels from journal lines. Deterministic: a label is the sum of
 * the lines whose snapshotted treatment maps to it (see `BAS_MAP` in
 * `server/au/gst.ts`), and the GST labels sum the GST the posting engine
 * computed at the time. Nothing here is estimated and nothing is rounded.
 *
 * W1 and W2 are not tax-code driven — they come from the wages and PAYG
 * withholding accounts named in `accounts`. Input-taxed supplies reach G1 and
 * G11 only through the verified rule in `accounts.inputTaxed`. Both are
 * product decisions that REQUIRE_VERIFICATION by the registered tax advisor.
 */
export function simpleBas(lines: readonly LedgerLine[], accounts: BasAccountMap): SimpleBas {
  const figure = (label: BasLabelKey): BasFigure => ({
    label,
    title: BAS_TITLES[label],
    cents: 0,
    contributors: [],
  });
  const figures: Record<BasLabelKey, BasFigure> = {
    G1: figure("G1"),
    G10: figure("G10"),
    G11: figure("G11"),
    "1A": figure("1A"),
    "1B": figure("1B"),
    W1: figure("W1"),
    W2: figure("W2"),
  };

  const add = (label: BasLabelKey, line: LedgerLine, cents: number) => {
    if (cents === 0) return;
    figures[label].cents += cents;
    figures[label].contributors.push(contributor(line, cents));
  };

  let unresolvedCount = 0;
  let inputTaxedOmittedCount = 0;

  for (const line of lines) {
    const treatment = line.gstTreatment;
    if (treatment === null || isUnresolved(treatment)) {
      unresolvedCount += 1;
      continue;
    }

    if (treatment === "INPUT_TAXED") {
      if (inputTaxedIsSale(line)) {
        if (accounts.inputTaxed.salesAtG1) add("G1", line, line.creditCents - line.debitCents);
        else inputTaxedOmittedCount += 1;
      } else {
        if (accounts.inputTaxed.purchasesAtG11) add("G11", line, line.debitCents - line.creditCents);
        else inputTaxedOmittedCount += 1;
      }
    } else {
      const gross = basGross(treatment, line);
      if (contributesTo(treatment, "G1")) add("G1", line, gross);
      if (contributesTo(treatment, "G10")) add("G10", line, gross);
      if (contributesTo(treatment, "G11")) add("G11", line, gross);
      if (contributesTo(treatment, "1A")) add("1A", line, line.gstCents);
      if (contributesTo(treatment, "1B")) add("1B", line, line.gstCents);
    }

    if (accounts.wagesCodes.includes(line.accountCode)) {
      add("W1", line, line.debitCents - line.creditCents);
    }
    if (line.accountCode === accounts.paygWithholdingCode) {
      add("W2", line, line.creditCents - line.debitCents);
    }
  }

  return {
    figures,
    netGstCents: figures["1A"].cents - figures["1B"].cents,
    unresolvedCount,
    inputTaxedOmittedCount,
    lineCount: lines.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Transactions Report — count / gross / GST / net per account                 */
/* -------------------------------------------------------------------------- */

/**
 * What was posted from bank transactions, summed per account. Reads the
 * ledger, never the bank rows: a transaction that has not been accepted has
 * no journal and appears nowhere here, so this report agrees with the P&L and
 * the BAS for the same period by construction.
 *
 * The bank side of each entry (Cash at Bank, the credit card account) is left
 * out — every posting has one, and summing it would double the period.
 */
export function transactionsReport(
  lines: readonly LedgerLine[],
  bankLedgerCodes: readonly number[],
): TransactionsReport {
  const bankSide = new Set(bankLedgerCodes);
  const byAccount = new Map<string, TransactionsReportLine>();
  let lineCount = 0;

  for (const line of lines) {
    if (line.entrySource !== "BANK") continue;
    if (bankSide.has(line.accountCode)) continue;
    lineCount += 1;

    const gross =
      line.accountType === "INCOME"
        ? line.creditCents - line.debitCents
        : line.debitCents - line.creditCents;
    const gst = line.gstCents;
    const existing = byAccount.get(line.accountId);
    const row: TransactionsReportLine = existing ?? {
      accountId: line.accountId,
      code: line.accountCode,
      name: line.accountName,
      type: line.accountType,
      count: 0,
      grossCents: 0,
      gstCents: 0,
      netCents: 0,
      contributors: [],
    };
    row.count += 1;
    row.grossCents += gross;
    row.gstCents += gst;
    row.netCents += gross - gst;
    row.contributors.push(contributor(line, gross));
    if (!existing) byAccount.set(line.accountId, row);
  }

  const accounts = [...byAccount.values()].sort((a, b) => a.code - b.code);
  return {
    accounts,
    totalCount: accounts.reduce((s, r) => s + r.count, 0),
    totalGrossCents: accounts.reduce((s, r) => s + r.grossCents, 0),
    totalGstCents: accounts.reduce((s, r) => s + r.gstCents, 0),
    totalNetCents: accounts.reduce((s, r) => s + r.netCents, 0),
    lineCount,
  };
}

/* -------------------------------------------------------------------------- */
/* TPAR — payments per subcontractor                                          */
/* -------------------------------------------------------------------------- */

export interface TparLineInput {
  readonly debitCents: number;
  readonly creditCents: number;
  readonly gstCents: number;
  readonly subcontractorId: string | null;
  readonly subcontractor: { name: string; abn: string | null } | null;
}

/**
 * The Taxable Payments Annual Report: gross paid to each subcontractor from
 * the lines on the reportable accounts. A payment with no subcontractor linked
 * is counted separately — it must be resolved, never guessed.
 */
export function tpar(rows: readonly TparLineInput[], fy: number, accountCodes: readonly number[], mappingVerified: boolean): TparReport {
  const byId = new Map<string, TparLine>();
  let unlinkedCount = 0;
  let unlinkedCents = 0;

  for (const row of rows) {
    const gross = row.debitCents - row.creditCents;
    if (!row.subcontractorId || !row.subcontractor) {
      unlinkedCount += 1;
      unlinkedCents += gross;
      continue;
    }
    const existing = byId.get(row.subcontractorId);
    if (existing) {
      existing.grossCents += gross;
      existing.gstCents += row.gstCents;
      existing.paymentCount += 1;
    } else {
      byId.set(row.subcontractorId, {
        subcontractorId: row.subcontractorId,
        name: row.subcontractor.name,
        abn: row.subcontractor.abn,
        grossCents: gross,
        gstCents: row.gstCents,
        paymentCount: 1,
      });
    }
  }

  const lines = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    fy,
    accountCodes: [...accountCodes],
    mappingVerified,
    lines,
    totalGrossCents: lines.reduce((s, l) => s + l.grossCents, 0),
    totalGstCents: lines.reduce((s, l) => s + l.gstCents, 0),
    unlinkedCount,
    unlinkedCents,
  };
}

import { contributesTo, isIncomeCode, isUnresolved } from "@/server/au/gst";
import type { AccountType, GstTreatment } from "@/shared/enums";
import type {
  BasContributor,
  BasFigure,
  BasLabelKey,
  ProfitAndLoss,
  ReportLine,
  SimpleBas,
} from "@/shared/contracts/report";

/**
 * THE reporting layer. Pure functions over journal lines.
 *
 * Every report in the product is a sum computed here. There is no other place
 * that adds up ledger amounts, so a P&L, a BAS and (later) a trial balance
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

/**
 * Simple BAS labels from journal lines. Deterministic: a label is the sum of
 * the lines whose snapshotted treatment maps to it (see `BAS_MAP` in
 * `server/au/gst.ts`), and the GST labels sum the GST the posting engine
 * computed at the time. Nothing here is estimated and nothing is rounded.
 *
 * W1 and W2 are not tax-code driven — they come from the wages and PAYG
 * withholding accounts named in `accounts`. That mapping is a product
 * decision that REQUIRES_VERIFICATION by the registered tax advisor.
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

  for (const line of lines) {
    const treatment = line.gstTreatment;
    if (treatment === null || isUnresolved(treatment)) {
      unresolvedCount += 1;
      continue;
    }

    const gross = basGross(treatment, line);
    if (contributesTo(treatment, "G1")) add("G1", line, gross);
    if (contributesTo(treatment, "G10")) add("G10", line, gross);
    if (contributesTo(treatment, "G11")) add("G11", line, gross);
    if (contributesTo(treatment, "1A")) add("1A", line, line.gstCents);
    if (contributesTo(treatment, "1B")) add("1B", line, line.gstCents);

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
    lineCount: lines.length,
  };
}

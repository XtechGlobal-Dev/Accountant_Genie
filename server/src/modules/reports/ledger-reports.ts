import { isExpenseCode, isIncomeCode } from "@/server/au/gst";
import type {
  BalanceSheet,
  GeneralLedger,
  GeneralLedgerAccount,
  ReportLine,
  TrialBalance,
  TrialBalanceLine,
} from "@/shared/contracts/report";
import { profitAndLoss, type LedgerLine } from "./aggregate";

/**
 * Balance Sheet, Trial Balance and General Ledger — pure functions over
 * journal lines, sharing the P&L's arithmetic for earnings so the three
 * statements cannot disagree.
 *
 * Journals are posted gross with the GST split recorded on each line. The
 * balance sheet therefore carries one derived line, the GST control, equal to
 * the GST on sales less the GST on purchases and capital across every posted
 * line. With income and expenses net of GST and assets net of the GST
 * claimed on them, Assets = Liabilities + GST control + Equity + earnings
 * holds exactly, because every journal balanced on gross.
 */

const round = (cents: number) => cents;

function debitNatural(line: LedgerLine): number {
  return line.debitCents - line.creditCents;
}

function creditNatural(line: LedgerLine): number {
  return line.creditCents - line.debitCents;
}

/** GST on this line's natural side, as it counts toward the GST control. */
function gstToControl(line: LedgerLine): number {
  const t = line.gstTreatment;
  if (!t) return 0;
  if (isIncomeCode(t)) return line.gstCents;
  if (isExpenseCode(t)) return -line.gstCents;
  return 0;
}

function sumByAccount(lines: readonly LedgerLine[], amount: (line: LedgerLine) => number): ReportLine[] {
  const totals = new Map<string, ReportLine>();
  for (const line of lines) {
    const cents = amount(line);
    const existing = totals.get(line.accountId);
    if (existing) existing.cents += cents;
    else totals.set(line.accountId, { accountId: line.accountId, code: line.accountCode, name: line.accountName, cents });
  }
  return [...totals.values()].filter((row) => row.cents !== 0).sort((a, b) => a.code - b.code);
}

const total = (rows: readonly ReportLine[]) => rows.reduce((sum, row) => sum + row.cents, 0);

/**
 * @param lines every line dated before `asAt` (exclusive), from the start of the ledger
 * @param fyStart 1 July of the financial year `asAt` falls in
 */
export function balanceSheet(lines: readonly LedgerLine[], fyStart: Date, asAt: Date): BalanceSheet {
  const assets = sumByAccount(
    lines.filter((l) => l.accountType === "ASSET"),
    (l) => debitNatural(l) - (l.gstTreatment && isExpenseCode(l.gstTreatment) ? l.gstCents : 0),
  );
  const liabilities = sumByAccount(lines.filter((l) => l.accountType === "LIABILITY"), creditNatural);
  const equity = sumByAccount(lines.filter((l) => l.accountType === "EQUITY"), creditNatural);

  const gstControlCents = lines.reduce((sum, l) => sum + gstToControl(l), 0);
  const prior = profitAndLoss(lines.filter((l) => l.date < fyStart));
  const current = profitAndLoss(lines.filter((l) => l.date >= fyStart));

  const totalAssetsCents = total(assets);
  const totalLiabilityAccountsCents = total(liabilities);
  const totalLiabilitiesCents = totalLiabilityAccountsCents + gstControlCents;
  const totalEquityAccountsCents = total(equity);
  const totalEquityCents = totalEquityAccountsCents + prior.netProfitCents + current.netProfitCents;

  return {
    asAt,
    assets,
    liabilities,
    equity,
    totalAssetsCents,
    totalLiabilityAccountsCents,
    gstControlCents,
    totalLiabilitiesCents,
    totalEquityAccountsCents,
    retainedEarningsCents: prior.netProfitCents,
    currentEarningsCents: current.netProfitCents,
    totalEquityCents,
    differenceCents: round(totalAssetsCents - totalLiabilitiesCents - totalEquityCents),
    lineCount: lines.length,
  };
}

/** Closing balances on gross postings. Sums to zero when every journal balanced. */
export function trialBalance(lines: readonly LedgerLine[], asAt: Date): TrialBalance {
  const balances = new Map<string, { code: number; name: string; cents: number }>();
  for (const line of lines) {
    const existing = balances.get(line.accountId);
    const cents = debitNatural(line);
    if (existing) existing.cents += cents;
    else balances.set(line.accountId, { code: line.accountCode, name: line.accountName, cents });
  }

  const rows: TrialBalanceLine[] = [...balances.entries()]
    .filter(([, b]) => b.cents !== 0)
    .map(([accountId, b]) => ({
      accountId,
      code: b.code,
      name: b.name,
      debitCents: b.cents > 0 ? b.cents : 0,
      creditCents: b.cents < 0 ? -b.cents : 0,
    }))
    .sort((a, b) => a.code - b.code);

  const totalDebitCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return {
    asAt,
    lines: rows,
    totalDebitCents,
    totalCreditCents,
    differenceCents: totalDebitCents - totalCreditCents,
    lineCount: lines.length,
  };
}

/**
 * Every account's movements in the period with a running balance, brought
 * forward from everything before it.
 *
 * @param lines every line dated before the period's end, from the start of the ledger
 */
export function generalLedger(lines: readonly LedgerLine[], start: Date): GeneralLedger {
  const accounts = new Map<string, GeneralLedgerAccount>();
  const sorted = [...lines].sort((a, b) => a.date.getTime() - b.date.getTime() || a.entryId.localeCompare(b.entryId));

  for (const line of sorted) {
    let account = accounts.get(line.accountId);
    if (!account) {
      account = {
        accountId: line.accountId,
        code: line.accountCode,
        name: line.accountName,
        openingCents: 0,
        entries: [],
        totalDebitCents: 0,
        totalCreditCents: 0,
        closingCents: 0,
      };
      accounts.set(line.accountId, account);
    }
    if (line.date < start) {
      account.openingCents += debitNatural(line);
      continue;
    }
    account.totalDebitCents += line.debitCents;
    account.totalCreditCents += line.creditCents;
    const previous = account.entries.at(-1)?.balanceCents ?? account.openingCents;
    account.entries.push({
      entryId: line.entryId,
      date: line.date,
      reference: line.reference,
      description: line.lineDescription ?? line.entryDescription,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      balanceCents: previous + debitNatural(line),
    });
  }

  const result = [...accounts.values()]
    .map((account) => ({
      ...account,
      closingCents: account.openingCents + account.totalDebitCents - account.totalCreditCents,
    }))
    .filter((account) => account.entries.length > 0 || account.openingCents !== 0)
    .sort((a, b) => a.code - b.code);

  return { accounts: result, lineCount: sorted.filter((l) => l.date >= start).length };
}

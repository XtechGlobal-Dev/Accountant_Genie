import "server-only";

import { CODE_PAYG_WITHHOLDING, CODE_SUBCONTRACTORS, CODE_WAGES } from "@/server/au/coa";
import { financialYearOf, financialYearRange } from "@/server/au/fy";
import * as assets from "@/server/modules/assets/service";
import * as clients from "@/server/modules/clients/repository";
import { getPartners } from "@/server/modules/clients/service";
import * as loans from "@/server/modules/loans/service";
import * as reconcile from "@/server/modules/reconcile/repository";
import { currentRule, parseCodes } from "@/server/modules/tax-rules/service";
import type { Partner } from "@/shared/contracts/client";
import type { DepreciationSchedule, LoanRow, TparLine, TparReport } from "@/shared/contracts/register";
import type {
  BalanceSheet,
  GeneralLedger,
  ProfitAndLoss,
  ReportPeriod,
  SimpleBas,
  TrialBalance,
} from "@/shared/contracts/report";
import type { TransactionRow } from "@/shared/contracts/transaction";
import { profitAndLoss, simpleBas, type LedgerLine } from "./aggregate";
import { journalsToMyobTxt, journalsToXeroCsv } from "./exports";
import { balanceSheet, generalLedger, trialBalance } from "./ledger-reports";
import * as repo from "./repository";

/**
 * Reports over the ledger. Each one loads lines through the ownership path
 * and hands them to a pure aggregator. `null` means the firm does not own the
 * client. Nothing in this file adds two amounts together.
 */

/**
 * Accounts whose gross reports at BAS label W1.
 *
 * Only Wages & Salaries (600). The chart replaced on 2026-09-16 has no
 * separate direct-wages account, and 325 — which used to be one — now means
 * Bank Charges, so it must NOT be listed here. Directors or Management Fees
 * (370) may also belong at W1; that is a question for the registered advisor,
 * not an assumption to make here.
 */
const WAGES_CODES: readonly number[] = [CODE_WAGES];

type Row = Awaited<ReturnType<typeof repo.listLinesInPeriod>>[number];

function toLedgerLine(row: Row): LedgerLine {
  return {
    entryId: row.entry.id,
    date: row.entry.date,
    reference: row.entry.reference,
    entryDescription: row.entry.description,
    lineDescription: row.description,
    accountId: row.accountId,
    accountCode: row.account.code,
    accountName: row.account.name,
    accountType: row.account.type,
    debitCents: row.debitCents,
    creditCents: row.creditCents,
    gstCents: row.gstCents,
    gstTreatment: row.gstTreatment,
  };
}

async function linesInPeriod(firmId: string, clientId: string, period: ReportPeriod) {
  return (await repo.listLinesInPeriod(firmId, clientId, period.start, period.end)).map(toLedgerLine);
}

async function linesUntil(firmId: string, clientId: string, end: Date) {
  return (await repo.listLinesUntil(firmId, clientId, end)).map(toLedgerLine);
}

/** The last day inside a half-open period, for "as at" headings. */
export function asAtOf(period: ReportPeriod): Date {
  return new Date(period.end.getTime() - 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Period reports                                                             */
/* -------------------------------------------------------------------------- */

export async function getProfitAndLoss(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<ProfitAndLoss | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return profitAndLoss(await linesInPeriod(firmId, client.id, period));
}

export interface BasReport {
  gstRegistered: boolean;
  bas: SimpleBas;
  /** Whether the W1/W2 account mapping has been verified by the tax advisor. */
  mappingVerified: boolean;
}

export async function getSimpleBas(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<BasReport | null> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return null;
  const asAt = asAtOf(period);
  const [lines, w1Rule, w2Rule] = await Promise.all([
    linesInPeriod(firmId, client.id, period),
    currentRule("BAS_W1_ACCOUNTS", asAt),
    currentRule("BAS_W2_ACCOUNT", asAt),
  ]);
  const wagesCodes = parseCodes(w1Rule?.valueText, WAGES_CODES);
  const paygWithholdingCode = parseCodes(w2Rule?.valueText, [CODE_PAYG_WITHHOLDING])[0] ?? CODE_PAYG_WITHHOLDING;
  return {
    gstRegistered: client.gstRegistered,
    bas: simpleBas(lines, { wagesCodes, paygWithholdingCode }),
    mappingVerified: w1Rule !== null && w2Rule !== null,
  };
}

export async function getGeneralLedger(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<GeneralLedger | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return generalLedger(await linesUntil(firmId, client.id, period.end), period.start);
}

/** Bank transactions dated inside the period, however far they got. */
export async function getTransactionsReport(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<TransactionRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const rows = await reconcile.listTransactions(firmId, client.id, 10_000, { start: period.start, end: period.end });
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description,
    normalised: row.normalised,
    amountCents: row.amountCents,
    balanceCents: row.balanceCents,
    status: row.status,
    needsReview: row.needsReview,
    risk: row.risk,
    source: row.source,
    confidence: row.confidence,
    reasoning: row.reasoning,
    accountId: row.accountId,
    accountCode: row.account?.code ?? null,
    accountName: row.account?.name ?? null,
    gstTreatment: row.gstTreatment,
    gstCents: row.gstCents,
    netCents: row.netCents,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.name,
    importId: row.importId,
    journalEntryId: row.journalEntryId,
    excludedAt: row.excludedAt,
    excludeReason: row.excludeReason,
    memoryRuleId: row.memoryRuleId,
    subcontractorId: row.subcontractorId,
  }));
}

/* -------------------------------------------------------------------------- */
/* As-at statements                                                           */
/* -------------------------------------------------------------------------- */

export async function getBalanceSheet(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<BalanceSheet | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const asAt = asAtOf(period);
  const fyStart = financialYearRange(financialYearOf(asAt)).start;
  return balanceSheet(await linesUntil(firmId, client.id, period.end), fyStart, asAt);
}

export async function getTrialBalance(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<TrialBalance | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return trialBalance(await linesUntil(firmId, client.id, period.end), asAtOf(period));
}

/* -------------------------------------------------------------------------- */
/* Register-backed reports                                                    */
/* -------------------------------------------------------------------------- */

export async function getTpar(firmId: string, clientId: string, fy: number): Promise<TparReport | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const range = financialYearRange(fy);
  const rows = await repo.listTparLines(firmId, client.id, range.start, range.end, [CODE_SUBCONTRACTORS]);

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
    lines,
    totalGrossCents: lines.reduce((s, l) => s + l.grossCents, 0),
    totalGstCents: lines.reduce((s, l) => s + l.gstCents, 0),
    unlinkedCount,
    unlinkedCents,
  };
}

export interface EofyStatement {
  fy: number;
  profitAndLoss: ProfitAndLoss;
  balanceSheet: BalanceSheet;
  depreciation: DepreciationSchedule;
  loans: { loan: LoanRow; balanceCents: number; interestYearCents: number }[];
  partners: Partner[] | null;
}

/** The year-end pack: ledger statements plus the registers, for one financial year. */
export async function getEofyStatement(
  firmId: string,
  clientId: string,
  fy: number,
): Promise<EofyStatement | null> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return null;
  const range = financialYearRange(fy);
  const period: ReportPeriod = { kind: "fy", fy, quarter: null, month: null, ...range };
  const asAt = asAtOf(period);

  const [inPeriod, untilEnd, depreciation, loanRows, partners] = await Promise.all([
    linesInPeriod(firmId, client.id, period),
    linesUntil(firmId, client.id, period.end),
    assets.getDepreciationSchedule(firmId, client.id, fy),
    loans.loanBalances(firmId, client.id, asAt),
    client.entityType === "PARTNERSHIP" ? getPartners(firmId, client.id) : Promise.resolve(null),
  ]);

  return {
    fy,
    profitAndLoss: profitAndLoss(inPeriod),
    balanceSheet: balanceSheet(untilEnd, range.start, asAt),
    depreciation: depreciation ?? { fy, lines: [], totalDepreciationCents: 0, totalDeductibleCents: 0, totalClosingCents: 0 },
    loans: loanRows ?? [],
    partners,
  };
}

/* -------------------------------------------------------------------------- */
/* Exports to other systems                                                   */
/* -------------------------------------------------------------------------- */

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

/** The period's journals in Xero or MYOB import layout. */
export async function getJournalExport(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
  format: "xero" | "myob",
): Promise<ExportFile | null> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return null;
  const lines = await linesInPeriod(firmId, client.id, period);
  const stem = `${client.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-journals-${period.label.replace(/\s+/g, "-").toLowerCase()}`;
  return format === "myob"
    ? { filename: `${stem}-myob.txt`, contentType: "text/tab-separated-values; charset=utf-8", body: journalsToMyobTxt(lines) }
    : { filename: `${stem}-xero.csv`, contentType: "text/csv; charset=utf-8", body: journalsToXeroCsv(lines) };
}

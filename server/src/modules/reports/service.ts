import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { CODE_PAYG_WITHHOLDING, CODE_SUBCONTRACTORS, CODE_WAGES } from "@/server/au/coa";
import { financialYearOf, financialYearRange } from "@/server/au/fy";
import * as assets from "@/server/modules/assets/service";
import * as clients from "@/server/modules/clients/repository";
import { getPartners } from "@/server/modules/clients/service";
import * as loans from "@/server/modules/loans/service";
import { currentRule, parseCodes, parseInputTaxedBasLabels } from "@/server/modules/tax-rules/service";
import type { Prisma } from "@/generated/prisma";
import type { Partner } from "@/shared/contracts/client";
import type { ActionResult } from "@/shared/contracts/result";
import type { DepreciationSchedule, LoanRow, TparReport } from "@/shared/contracts/register";
import type {
  BalanceSheet,
  BasLabelKey,
  BasStatementRow,
  BasStatementView,
  GeneralLedger,
  ProfitAndLoss,
  ReportPeriod,
  SimpleBas,
  TransactionsReport,
  TrialBalance,
} from "@/shared/contracts/report";
import { profitAndLoss, simpleBas, tpar, transactionsReport, type LedgerLine } from "./aggregate";
import { journalsToMyobTxt, journalsToXeroCsv } from "./exports";
import { balanceSheet, generalLedger, trialBalance } from "./ledger-reports";
import * as repo from "./repository";

/**
 * Reports over the ledger. Each one loads lines through the ownership path
 * and hands them to a pure aggregator. `null` means the firm does not own the
 * client. Nothing in this file adds two amounts together — the aggregators in
 * `aggregate.ts` and `ledger-reports.ts` do, once, for every report.
 */

/** Direct wages (325) and Wages & Salaries (477) both report at W1. */
const WAGES_CODES: readonly number[] = [325, CODE_WAGES];

/** The BAS labels a prepared statement records, in form order. */
const BAS_LABELS: readonly BasLabelKey[] = ["G1", "G10", "G11", "1A", "1B", "W1", "W2"];

/** The tax rules a Simple BAS consults, so a prepared statement can name their versions. */
const BAS_RULES = ["BAS_W1_ACCOUNTS", "BAS_W2_ACCOUNT", "INPUT_TAXED_BAS_LABELS", "GST_RATE_PERCENT"] as const;

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
    entrySource: row.entry.source,
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
  /** Whether the input-taxed G1/G11 rule has been verified. */
  inputTaxedVerified: boolean;
  /** The verified rule versions consulted, by code — null where none is verified. */
  ruleVersions: Record<string, string | null>;
}

/** The rule versions and derived mappings a BAS for this firm uses on a date. */
async function basRules(firmId: string, asAt: Date) {
  const [w1Rule, w2Rule, inputTaxedRule, gstRule] = await Promise.all([
    currentRule(firmId, "BAS_W1_ACCOUNTS", asAt),
    currentRule(firmId, "BAS_W2_ACCOUNT", asAt),
    currentRule(firmId, "INPUT_TAXED_BAS_LABELS", asAt),
    currentRule(firmId, "GST_RATE_PERCENT", asAt),
  ]);
  return {
    wagesCodes: parseCodes(w1Rule?.valueText, WAGES_CODES),
    paygWithholdingCode: parseCodes(w2Rule?.valueText, [CODE_PAYG_WITHHOLDING])[0] ?? CODE_PAYG_WITHHOLDING,
    // Unverified means neither label includes them; parse of null yields both false.
    inputTaxed: parseInputTaxedBasLabels(inputTaxedRule?.valueText),
    mappingVerified: w1Rule !== null && w2Rule !== null,
    inputTaxedVerified: inputTaxedRule !== null,
    ruleVersions: {
      BAS_W1_ACCOUNTS: w1Rule?.id ?? null,
      BAS_W2_ACCOUNT: w2Rule?.id ?? null,
      INPUT_TAXED_BAS_LABELS: inputTaxedRule?.id ?? null,
      GST_RATE_PERCENT: gstRule?.id ?? null,
    } satisfies Record<(typeof BAS_RULES)[number], string | null>,
  };
}

export async function getSimpleBas(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<BasReport | null> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return null;
  const asAt = asAtOf(period);
  const [lines, rules] = await Promise.all([linesInPeriod(firmId, client.id, period), basRules(firmId, asAt)]);
  return {
    gstRegistered: client.gstRegistered,
    bas: simpleBas(lines, { wagesCodes: rules.wagesCodes, paygWithholdingCode: rules.paygWithholdingCode, inputTaxed: rules.inputTaxed }),
    mappingVerified: rules.mappingVerified,
    inputTaxedVerified: rules.inputTaxedVerified,
    ruleVersions: rules.ruleVersions,
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

/**
 * What was posted from bank transactions in the period, per account. Built
 * from journal lines — a bank row that has not been accepted has no journal
 * and is not in this report, which is what keeps it in agreement with the
 * P&L and the BAS.
 */
export async function getTransactionsReport(
  firmId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<TransactionsReport | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const [lines, bankCodes] = await Promise.all([linesInPeriod(firmId, client.id, period), repo.listBankLedgerCodes()]);
  return transactionsReport(
    lines,
    bankCodes.map((a) => a.code),
  );
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

/**
 * Which accounts are TPAR-reportable is the verified TPAR_ACCOUNTS rule for
 * this firm; until one exists the chart's Subcontractor Payments account is
 * used and the report says the mapping is unverified.
 */
export async function getTpar(firmId: string, clientId: string, fy: number): Promise<TparReport | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const range = financialYearRange(fy);
  const rule = await currentRule(firmId, "TPAR_ACCOUNTS", new Date(range.end.getTime() - 1));
  const codes = parseCodes(rule?.valueText, [CODE_SUBCONTRACTORS]);
  const rows = await repo.listTparLines(firmId, client.id, range.start, range.end, codes);
  return tpar(rows, fy, codes, rule !== null);
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
/* Prepared BAS statements                                                    */
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

function isBasLabel(value: string): value is BasLabelKey {
  return (BAS_LABELS as readonly string[]).includes(value);
}

function toStatementView(row: repo.StatementRow): BasStatementView {
  const lines = row.lines
    .filter((line) => isBasLabel(line.label))
    .map((line) => ({
      label: line.label as BasLabelKey,
      title: BAS_TITLES[line.label as BasLabelKey],
      calculatedCents: line.calculatedCents,
      adjustmentCents: line.adjustmentCents,
      finalCents: line.finalCents,
      note: line.note,
    }))
    .sort((a, b) => BAS_LABELS.indexOf(a.label) - BAS_LABELS.indexOf(b.label));
  const final = (label: BasLabelKey) => lines.find((l) => l.label === label)?.finalCents ?? 0;
  return {
    id: row.id,
    clientId: row.clientId,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    fy: row.fy,
    quarter: row.quarter,
    month: row.month,
    status: row.status,
    gstRegistered: row.gstRegistered,
    mappingVerified: row.mappingVerified,
    taxRuleVersions: (row.taxRuleVersions as Record<string, string | null> | null) ?? {},
    lineCount: row.lineCount,
    unresolvedCount: row.unresolvedCount,
    preparedBy: row.preparedBy?.name ?? null,
    finalisedBy: row.finalisedBy?.name ?? null,
    finalisedAt: row.finalisedAt,
    version: row.version,
    createdAt: row.createdAt,
    lines,
    netGstCents: final("1A") - final("1B"),
  };
}

export async function listBasStatements(firmId: string, clientId: string): Promise<BasStatementRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return (await repo.listStatements(firmId, client.id)).map((row) => {
    const view = toStatementView(row);
    return {
      id: view.id,
      periodLabel: view.periodLabel,
      status: view.status,
      netGstCents: view.netGstCents,
      preparedBy: view.preparedBy,
      createdAt: view.createdAt,
      finalisedAt: view.finalisedAt,
    };
  });
}

export async function getBasStatement(firmId: string, clientId: string, statementId: string): Promise<BasStatementView | null> {
  const row = await repo.findOwnedStatement(firmId, clientId, statementId);
  return row ? toStatementView(row) : null;
}

/**
 * Keep the BAS as it stands right now. Every label is stored with its
 * calculated figure, a zero adjustment and a final equal to the calculation;
 * the verified rule versions consulted are recorded with it. A statement is
 * refused while any line in the period is unresolved — a BAS with a guess in
 * it is not a BAS.
 */
export async function prepareBasStatement(
  firmId: string,
  userId: string,
  clientId: string,
  period: ReportPeriod,
): Promise<ActionResult> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };
  const report = await getSimpleBas(firmId, client.id, period);
  if (!report) return { ok: false, error: "Client not found" };
  if (report.bas.unresolvedCount > 0) {
    return {
      ok: false,
      error: `${report.bas.unresolvedCount} journal line${report.bas.unresolvedCount === 1 ? "" : "s"} in the period still have no tax treatment. Code them before preparing the statement.`,
    };
  }

  const id = await db.$transaction(async (tx) => {
    const created = await repo.createStatement(tx, {
      clientId: client.id,
      periodStart: period.start,
      periodEnd: period.end,
      periodLabel: period.label,
      fy: period.fy,
      quarter: period.quarter,
      month: period.month,
      gstRegistered: client.gstRegistered,
      gstBasis: client.gstBasis,
      mappingVerified: report.mappingVerified && report.inputTaxedVerified,
      taxRuleVersions: report.ruleVersions as Prisma.InputJsonValue,
      lineCount: report.bas.lineCount,
      unresolvedCount: report.bas.unresolvedCount,
      preparedById: userId,
      lines: {
        create: BAS_LABELS.map((label) => ({
          label,
          calculatedCents: report.bas.figures[label].cents,
          adjustmentCents: 0,
          finalCents: report.bas.figures[label].cents,
        })),
      },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "BAS_GENERATED",
      entityType: "BasStatement",
      entityId: created.id,
      after: {
        period: period.label,
        netGstCents: report.bas.netGstCents,
        labels: Object.fromEntries(BAS_LABELS.map((label) => [label, report.bas.figures[label].cents])),
        ruleVersions: report.ruleVersions,
        mappingVerified: report.mappingVerified,
        inputTaxedVerified: report.inputTaxedVerified,
      },
    });
    return created.id;
  });
  return { ok: true, id };
}

/**
 * A manual adjustment to one label of a DRAFT statement, with its reason.
 * The calculated figure is untouched; the final is calculated + adjustment,
 * and the database refuses any row where it is not.
 */
export async function adjustBasLine(
  firmId: string,
  userId: string,
  clientId: string,
  statementId: string,
  input: { label: string; adjustmentCents: number; note: string | null; version: number },
): Promise<ActionResult> {
  const statement = await repo.findOwnedStatement(firmId, clientId, statementId);
  if (!statement) return { ok: false, error: "Statement not found" };
  if (statement.status !== "DRAFT") return { ok: false, error: "A finalised statement is not edited. Prepare a new one." };
  if (!isBasLabel(input.label)) return { ok: false, error: "Unknown label", field: "label" };
  if (input.adjustmentCents !== 0 && !input.note) {
    return { ok: false, error: "Say why the figure is being adjusted", field: "note" };
  }
  const line = statement.lines.find((l) => l.label === input.label);
  if (!line) return { ok: false, error: "Unknown label", field: "label" };

  const conflict = await db.$transaction(async (tx) => {
    const written = await repo.adjustStatementLine(
      tx,
      firmId,
      statement.id,
      input.version,
      input.label,
      input.adjustmentCents,
      line.calculatedCents + input.adjustmentCents,
      input.note,
    );
    if (written === 0) return true;
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "BAS_ADJUSTED",
      entityType: "BasStatement",
      entityId: statement.id,
      before: { label: input.label, calculatedCents: line.calculatedCents, adjustmentCents: line.adjustmentCents, finalCents: line.finalCents },
      after: {
        label: input.label,
        calculatedCents: line.calculatedCents,
        adjustmentCents: input.adjustmentCents,
        finalCents: line.calculatedCents + input.adjustmentCents,
        note: input.note,
      },
    });
    return false;
  });
  if (conflict) return { ok: false, error: "This statement changed while you were editing it. Reload and try again." };
  return { ok: true, id: statement.id };
}

/** Sign the statement off. Once FINAL it is never edited; a correction is a new statement. */
export async function finaliseBasStatement(
  firmId: string,
  userId: string,
  clientId: string,
  statementId: string,
  version: number,
): Promise<ActionResult> {
  const statement = await repo.findOwnedStatement(firmId, clientId, statementId);
  if (!statement) return { ok: false, error: "Statement not found" };
  if (statement.status !== "DRAFT") return { ok: true, id: statement.id };

  const conflict = await db.$transaction(async (tx) => {
    const written = await repo.finaliseStatement(tx, firmId, statement.id, userId, version);
    if (written === 0) return true;
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "BAS_FINALISED",
      entityType: "BasStatement",
      entityId: statement.id,
      after: {
        period: statement.periodLabel,
        labels: Object.fromEntries(statement.lines.map((l) => [l.label, l.finalCents])),
      },
    });
    return false;
  });
  if (conflict) return { ok: false, error: "This statement changed while you were finalising it. Reload and try again." };
  return { ok: true, id: statement.id };
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

/**
 * Report read models.
 *
 * Every figure here is a sum over journal lines, computed by the reporting
 * layer in `server/modules/reports/aggregate.ts` and nowhere else. A page
 * renders these; it never adds two of them together.
 */

/** An account's total for the period. */
export interface ReportLine {
  accountId: string;
  code: number;
  name: string;
  cents: number;
}

export interface ProfitAndLoss {
  income: ReportLine[];
  cogs: ReportLine[];
  expenses: ReportLine[];
  totalIncomeCents: number;
  totalCogsCents: number;
  grossProfitCents: number;
  totalExpensesCents: number;
  netProfitCents: number;
  /** Journal lines the report was built from. Zero means "nothing posted". */
  lineCount: number;
}

export type BasLabelKey = "G1" | "G10" | "G11" | "1A" | "1B" | "W1" | "W2";

/** One journal line's contribution to a BAS label — the lineage behind a figure. */
export interface BasContributor {
  entryId: string;
  date: Date;
  reference: string | null;
  description: string | null;
  accountCode: number;
  accountName: string;
  cents: number;
}

export interface BasFigure {
  label: BasLabelKey;
  title: string;
  cents: number;
  contributors: BasContributor[];
}

export interface SimpleBas {
  figures: Record<BasLabelKey, BasFigure>;
  /** 1A − 1B. Positive is owed to the ATO. */
  netGstCents: number;
  /** Lines whose tax treatment was never resolved. A BAS with any is not ready. */
  unresolvedCount: number;
  /** Input-taxed lines left out of G1/G11 because the rule that includes them is not verified. */
  inputTaxedOmittedCount: number;
  lineCount: number;
}

/* -------------------------------------------------------------------------- */
/* Transactions report                                                        */
/* -------------------------------------------------------------------------- */

/** One account's postings from bank transactions in the period. */
export interface TransactionsReportLine {
  accountId: string;
  code: number;
  name: string;
  type: import("@/shared/enums").AccountType;
  /** Journal lines — one per accepted bank transaction. */
  count: number;
  /** Gross from the account's natural side, GST inclusive. */
  grossCents: number;
  gstCents: number;
  /** Gross less GST. */
  netCents: number;
  contributors: BasContributor[];
}

export interface TransactionsReport {
  accounts: TransactionsReportLine[];
  totalCount: number;
  totalGrossCents: number;
  totalGstCents: number;
  totalNetCents: number;
  /** Bank-sourced journal lines the report was built from, bank side excluded. */
  lineCount: number;
}

/* -------------------------------------------------------------------------- */
/* Prepared BAS statements                                                    */
/* -------------------------------------------------------------------------- */

export type BasStatementStatusKind = "DRAFT" | "FINAL";

/** One label as it was prepared: what was computed, what was adjusted, what stands. */
export interface BasStatementLineView {
  label: BasLabelKey;
  title: string;
  calculatedCents: number;
  adjustmentCents: number;
  finalCents: number;
  note: string | null;
}

export interface BasStatementView {
  id: string;
  clientId: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  fy: number;
  quarter: number | null;
  month: number | null;
  status: BasStatementStatusKind;
  gstRegistered: boolean;
  mappingVerified: boolean;
  /** { ruleCode: taxRuleVersionId | null } as consulted when prepared. */
  taxRuleVersions: Record<string, string | null>;
  lineCount: number;
  unresolvedCount: number;
  preparedBy: string | null;
  finalisedBy: string | null;
  finalisedAt: Date | null;
  version: number;
  createdAt: Date;
  lines: BasStatementLineView[];
  /** 1A − 1B on the final figures. */
  netGstCents: number;
}

/** A prepared statement as the BAS page lists them. */
export interface BasStatementRow {
  id: string;
  periodLabel: string;
  status: BasStatementStatusKind;
  netGstCents: number;
  preparedBy: string | null;
  createdAt: Date;
  finalisedAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/* Balance sheet, trial balance, general ledger                               */
/* -------------------------------------------------------------------------- */

export interface BalanceSheet {
  asAt: Date;
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  totalAssetsCents: number;
  /** Liabilities on accounts, before the GST control line. */
  totalLiabilityAccountsCents: number;
  /** Net GST owed to (positive) or by (negative) the ATO, from every posted line. */
  gstControlCents: number;
  totalLiabilitiesCents: number;
  /** Equity on accounts, before earnings. */
  totalEquityAccountsCents: number;
  /** Net profit of financial years before the current one. */
  retainedEarningsCents: number;
  /** Net profit from 1 July to the as-at date. */
  currentEarningsCents: number;
  totalEquityCents: number;
  /** Assets − (liabilities + equity). Zero when the ledger balances. */
  differenceCents: number;
  lineCount: number;
}

export interface TrialBalanceLine {
  accountId: string;
  code: number;
  name: string;
  /** Closing balance on the debit side, when the account has one. */
  debitCents: number;
  /** Closing balance on the credit side, when the account has one. */
  creditCents: number;
}

export interface TrialBalance {
  asAt: Date;
  lines: TrialBalanceLine[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Debits − credits. Zero when every journal balanced. */
  differenceCents: number;
  lineCount: number;
}

export interface GeneralLedgerEntry {
  entryId: string;
  date: Date;
  reference: string | null;
  description: string | null;
  debitCents: number;
  creditCents: number;
  /** Debit-positive running balance after this line. */
  balanceCents: number;
}

export interface GeneralLedgerAccount {
  accountId: string;
  code: number;
  name: string;
  /** Debit-positive balance brought forward from before the period. */
  openingCents: number;
  entries: GeneralLedgerEntry[];
  totalDebitCents: number;
  totalCreditCents: number;
  closingCents: number;
}

export interface GeneralLedger {
  accounts: GeneralLedgerAccount[];
  lineCount: number;
}

/** The period a report covers, chosen from the URL. */
export interface ReportPeriod {
  kind: "fy" | "quarter" | "month";
  /** The financial year ending 30 June of this year. */
  fy: number;
  quarter: 1 | 2 | 3 | 4 | null;
  /** 0–11 counting from July, when the kind is "month". */
  month: number | null;
  start: Date;
  /** Exclusive. */
  end: Date;
  label: string;
}

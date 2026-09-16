/**
 * The registers behind the specialist reports: subcontractors (TPAR), assets
 * (depreciation) and loans. Money is integer cents; rates and shares are
 * basis points.
 */

import type { AssetCategory, DepreciationMethod, LoanFrequency, LoanStatus, LoanType } from "@/shared/enums";

export interface SubcontractorRow {
  id: string;
  name: string;
  abn: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  /** Payments linked to this subcontractor, across journal lines. */
  paymentCount: number;
  createdAt: Date;
}

/** One unlinked payment and what the model proposes for it. A person confirms; nothing is written. */
export interface SubcontractorProposal {
  transactionId: string;
  date: Date;
  description: string;
  amountCents: number;
  /** A subcontractor already on the register, when the payment matches one. */
  knownId: string | null;
  knownName: string | null;
  /** A trading name to add, when the payee is not on the register. */
  proposedName: string | null;
  confidence: number;
  reason: string;
}

export interface SubcontractorProposals {
  proposals: SubcontractorProposal[];
  provider: string | null;
  promptVersion: string | null;
  /** Set when the model declined or failed; every proposal is then empty. */
  failure: string | null;
}

export interface AssetRow {
  id: string;
  name: string;
  description: string | null;
  category: AssetCategory;
  /** The depreciable cost. */
  costCents: number;
  /** What was paid, GST included, when recorded. */
  totalCostCents: number | null;
  gstCents: number | null;
  purchaseDate: Date;
  method: DepreciationMethod;
  effectiveLifeMonths: number;
  privateUseBasisPoints: number;
  isCar: boolean;
  accountId: string | null;
  accountName: string | null;
  disposedAt: Date | null;
  disposalCents: number | null;
  createdAt: Date;
}

export interface LoanRow {
  id: string;
  type: LoanType;
  lender: string;
  description: string | null;
  principalCents: number;
  interestRateBasisPoints: number;
  startDate: Date;
  termMonths: number;
  repaymentCents: number;
  frequency: LoanFrequency;
  status: LoanStatus;
  accountId: string | null;
  accountName: string | null;
  createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Schedules — every figure computed by the reporting layer                    */
/* -------------------------------------------------------------------------- */

/** One asset's depreciation for one financial year. */
export interface DepreciationLine {
  assetId: string;
  name: string;
  method: DepreciationMethod;
  costCents: number;
  /** Written-down value at the start of the year. */
  openingCents: number;
  /** Depreciation for the year before the private-use reduction. */
  depreciationCents: number;
  privateUseBasisPoints: number;
  /** The deductible share after private use. */
  deductibleCents: number;
  /** Written-down value at the end of the year. */
  closingCents: number;
  /** Days the asset was held in the year — a mid-year purchase is pro-rated. */
  daysHeld: number;
}

export interface DepreciationSchedule {
  fy: number;
  /** Which verified thresholds were applied. */
  thresholds?: { writeOffCents: number | null; carLimitCents: number | null } | undefined;
  /** False when the method rates are the statutory fallback rather than a verified rule. */
  methodsVerified?: boolean | undefined;
  /** The verified tax rule versions the schedule was computed under, by rule code. */
  ruleVersions?: Record<string, string | null> | undefined;
  lines: DepreciationLine[];
  totalDepreciationCents: number;
  totalDeductibleCents: number;
  totalClosingCents: number;
}

/** One repayment in a loan's amortisation. */
export interface LoanScheduleRow {
  period: number;
  date: Date;
  openingCents: number;
  interestCents: number;
  principalCents: number;
  repaymentCents: number;
  closingCents: number;
}

export interface LoanSchedule {
  rows: LoanScheduleRow[];
  totalInterestCents: number;
  totalPrincipalCents: number;
  /** Set when the repayment does not clear the loan inside its term. */
  balloonCents: number;
  /** The closing balance as at a given date, for the balance sheet. */
  balanceAtCents: number;
}

/** TPAR: what was paid to each subcontractor in a financial year. */
export interface TparLine {
  subcontractorId: string;
  name: string;
  abn: string | null;
  /** Gross payments including GST. */
  grossCents: number;
  gstCents: number;
  paymentCount: number;
}

export interface TparReport {
  fy: number;
  /** The account codes the report sums — from the verified TPAR_ACCOUNTS rule, or the chart's default. */
  accountCodes: number[];
  /** Whether that mapping has been verified by the firm's registered tax advisor. */
  mappingVerified: boolean;
  lines: TparLine[];
  totalGrossCents: number;
  totalGstCents: number;
  /** Subcontractor payments on the ledger not linked to any subcontractor — must be resolved. */
  unlinkedCount: number;
  unlinkedCents: number;
}

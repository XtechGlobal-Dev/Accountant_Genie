/**
 * Display labels for domain enums.
 *
 * One place, so "Sole trader" reads the same on the client list, the workspace
 * header and any report that names an entity type. Screaming-snake enum values
 * never reach a person's eyes.
 */

import type {
  AccountType,
  AssetCategory,
  BankAccountKind,
  BasFrequency,
  BeneficiaryKind,
  EntityType,
  GstBasis,
  GstTreatment,
  ImportStatus,
  JournalSource,
  LoanType,
  TrusteeKind,
  TxStatus,
} from "@/shared/enums";
import type { AccountScope } from "@/shared/contracts/account";

export const ENTITY_LABELS: Record<EntityType, string> = {
  COMPANY: "Company",
  PARTNERSHIP: "Partnership",
  SOLE_TRADER: "Sole trader",
  UNIT_TRUST: "Unit trust",
  DISCRETIONARY_TRUST: "Discretionary trust",
};

export const TRUSTEE_KIND_LABELS: Record<TrusteeKind, string> = {
  CORPORATE: "Corporate trustee",
  INDIVIDUAL: "Individual trustee",
};

export const BENEFICIARY_KIND_LABELS: Record<BeneficiaryKind, string> = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
  TRUST: "Trust",
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  COMPUTER_EQUIPMENT: "Computer equipment",
  FURNITURE_FIXTURES: "Furniture & fixtures",
  OFFICE_EQUIPMENT: "Office equipment & machinery",
  TOOLS_EQUIPMENT: "Tools & equipment",
  MOTOR_VEHICLES: "Motor vehicles",
  PLANT_EQUIPMENT: "Plant & equipment",
  OTHER: "Other",
};

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  EQUIPMENT_FINANCE: "Equipment finance",
  EQUIPMENT_FINANCE_LONG_TERM: "Equipment finance, long term",
  BANK_LOAN_LONG_TERM: "Bank loan, long term",
  BANK_LOAN: "Bank loan",
};

export const GST_BASIS_LABELS: Record<GstBasis, string> = {
  CASH: "Cash",
  ACCRUAL: "Accruals",
};

export const BAS_FREQUENCY_LABELS: Record<BasFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

export const BANK_KIND_LABELS: Record<BankAccountKind, string> = {
  BANK: "Bank account",
  CREDIT_CARD: "Credit card",
};

/**
 * CDR product categories, as an accountant would name them.
 *
 * Worth showing rather than collapsing into "Bank account": a consent commonly
 * returns the client's mortgage and credit cards alongside their transaction
 * account, and those are liabilities. Calling a home loan a "Bank account"
 * invites somebody to treat it as cash.
 *
 * An unrecognised category falls back to the raw value rather than a guess —
 * the CDR standard adds categories, and inventing a label for one we do not
 * know would be worse than showing what the bank said.
 */
export const FEED_PRODUCT_LABELS: Record<string, string> = {
  TRANS_AND_SAVINGS_ACCOUNTS: "Transaction / savings",
  TERM_DEPOSITS: "Term deposit",
  CRED_AND_CHRG_CARDS: "Credit / charge card",
  RESIDENTIAL_MORTGAGES: "Mortgage",
  PERS_LOANS: "Personal loan",
  BUSINESS_LOANS: "Business loan",
  MARGIN_LENDING: "Margin lending",
  LEASES: "Lease",
  TRADE_FINANCE: "Trade finance",
  OVERDRAFTS: "Overdraft",
  TRAVEL_CARDS: "Travel card",
  REGULATED_TRUST_ACCOUNTS: "Trust account",
};

export function feedProductLabel(category: string | null | undefined): string | null {
  if (!category) return null;
  return FEED_PRODUCT_LABELS[category] ?? category.replace(/_/g, " ").toLowerCase();
}

export const TX_STATUS_LABELS: Record<TxStatus, string> = {
  PENDING: "Not yet coded",
  CLASSIFIED: "Awaiting review",
  REVIEWED: "Reviewed",
};

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  PARSING: "Parsing",
  RECONCILING: "Reconciling",
  COMPLETE: "Complete",
  FAILED: "Failed",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  INCOME: "Income",
  COGS: "Direct costs",
  EXPENSE: "Expense",
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  UNKNOWN: "Unallocated",
};

/** Standard AU tax-code vocabulary. */
export const GST_TREATMENT_LABELS: Record<GstTreatment, string> = {
  GST_ON_INCOME: "GST on Income",
  GST_FREE_INCOME: "GST Free Income",
  GST_ON_EXPENSES: "GST on Expenses",
  GST_FREE_EXPENSES: "GST Free Expenses",
  GST_ON_CAPITAL: "GST on Capital",
  GST_FREE_CAPITAL: "GST Free Capital",
  INPUT_TAXED: "Input Taxed",
  BAS_EXCLUDED: "BAS Excluded",
  UNALLOCATED: "Allocate",
};

export const ACCOUNT_SCOPE_LABELS: Record<AccountScope, string> = {
  SYSTEM: "System",
  FIRM: "All clients",
  CLIENT: "This client",
};

export const JOURNAL_SOURCE_LABELS: Record<JournalSource, string> = {
  BANK: "Bank",
  MANUAL: "Manual",
  OPENING: "Opening balance",
};

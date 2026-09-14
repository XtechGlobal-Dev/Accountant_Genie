/**
 * Bank transactions as the review screen sees them, the memory rules that
 * code them, and the shape of an import's outcome.
 */

import type { ClassificationSource, GstTreatment, MatchType, TxStatus } from "@/shared/enums";

export interface TransactionRow {
  id: string;
  date: Date;
  description: string;
  /** The description as rules and memory see it. */
  normalised: string;
  /** Signed: negative is money out. */
  amountCents: number;
  balanceCents: number | null;
  status: TxStatus;
  needsReview: boolean;
  risk: string | null;
  source: ClassificationSource | null;
  confidence: number | null;
  reasoning: string | null;
  accountId: string | null;
  accountCode: number | null;
  accountName: string | null;
  gstTreatment: GstTreatment | null;
  gstCents: number;
  netCents: number;
  bankAccountId: string;
  bankAccountName: string;
  importId: string | null;
  journalEntryId: string | null;
  excludedAt: Date | null;
  excludeReason: string | null;
  memoryRuleId: string | null;
  subcontractorId: string | null;
}

/** Counts for the review screen's filter chips. */
export interface ReviewSummary {
  total: number;
  /** Parsed, not yet through the engine. */
  notCoded: number;
  /** Coded, and a person must look. */
  needsReview: number;
  /** Coded with confidence; awaiting sign-off. */
  coded: number;
  reviewed: number;
  excluded: number;
}

export type MemoryScope = "CLIENT" | "FIRM";

export interface MemoryRuleRow {
  id: string;
  pattern: string;
  matchType: MatchType;
  scope: MemoryScope;
  clientId: string | null;
  clientName: string | null;
  accountId: string;
  accountCode: number;
  accountName: string;
  gstTreatment: GstTreatment;
  hitCount: number;
  evidenceCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** How a reconciliation run went. */
export interface ReconcileStats {
  processed: number;
  byMemory: number;
  byRule: number;
  byAi: number;
  unknown: number;
  needsReview: number;
  autoCoded: number;
  /** Set when the AI tier failed or refused; the batch went to review. */
  aiFailure: string | null;
}

export interface ImportOutcome {
  importId: string;
  jobId: string | null;
  status: "PARSING" | "RECONCILING" | "COMPLETE" | "FAILED";
  error: string | null;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  reconcile: ReconcileStats | null;
}

/** A client and its bank accounts, for the upload dialog's pickers. */
export interface UploadTarget {
  clientId: string;
  clientName: string;
  bankAccounts: { id: string; name: string }[];
}

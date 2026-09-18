/**
 * Bank transactions as the review screen sees them, the memory rules that
 * code them, and the shape of an import's outcome.
 */

import type { ClassificationSource, GstTreatment, MatchType, RiskLevel, TxStatus } from "@/shared/enums";

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
  risk: RiskLevel | null;
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
  /** The loan facility a repayment settles, when linked. */
  loanId: string | null;
  /** Optimistic lock: sent back with a recode so a stale edit is refused. */
  version: number;
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
  version: number;
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
  /** (memory + rules) ÷ processed. The skill's target is ≥ 0.60. */
  preAiRatio: number;
  /** Token usage across every AI call in the run — what the run cost to make. */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number };
  /** Things an operator should know: a missed pre-AI target, a cold cache. */
  warnings: string[];
  /** Accounts the run created from AI proposals, after the resolver found nothing equivalent. */
  accountsCreated: { code: number; name: string }[];
  /** Why rows went to review, most common first — so the upload dialog can say, not just count. */
  reviewReasons: { reason: string; count: number }[];
  /**
   * The AI reviewer's pass over the classifier's codings. `checked` rows got
   * a verdict; `cleared` is how many an AGREE moved to Ready that would
   * otherwise have waited for a person. `failure` is set when the reviewer
   * declined or failed, in which case the rows kept the classifier's routing.
   */
  reviewer: { checked: number; agreed: number; disagreed: number; escalated: number; cleared: number; failure: string | null };
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

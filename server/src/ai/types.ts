import { z } from "zod";
import type { GstTreatment } from "@/generated/prisma";

/**
 * Provider-agnostic contract for AI classification.
 *
 * The application never talks to a vendor SDK directly. Swapping OpenAI for
 * Anthropic, Azure, or a local model is a change to one file behind this
 * interface — see .claude/skills/ai-classification/SKILL.md.
 */

/** Tax codes the model is allowed to choose from. Mirrors the Prisma enum. */
export const GST_TREATMENT_VALUES = [
  "GST_ON_INCOME",
  "GST_FREE_INCOME",
  "GST_ON_EXPENSES",
  "GST_FREE_EXPENSES",
  "GST_ON_CAPITAL",
  "GST_FREE_CAPITAL",
  "INPUT_TAXED",
  "BAS_EXCLUDED",
  "UNALLOCATED",
] as const satisfies readonly GstTreatment[];

/**
 * NOTE: no .min()/.max()/.describe() refinements on numbers here.
 * OpenAI's strict structured-output JSON Schema subset rejects numeric
 * constraints, so ranges are validated in code after parsing instead.
 */
/** Account types the model may propose. UNKNOWN is a sentinel and cannot be proposed. */
export const PROPOSABLE_ACCOUNT_TYPES = ["INCOME", "COGS", "EXPENSE", "ASSET", "LIABILITY", "EQUITY"] as const;

/**
 * What the model says when nothing in the chart fits: the NATURE of the
 * supply as an account, never the vendor. The backend decides whether an
 * existing account already covers it, and allocates the code if not — the
 * model never chooses a code for an account that does not exist.
 */
export const ProposedAccountSchema = z.object({
  name: z.string(),
  type: z.enum(PROPOSABLE_ACCOUNT_TYPES),
  gstTreatment: z.enum(GST_TREATMENT_VALUES),
});

export const ClassificationResultSchema = z.object({
  /** Echoes the transaction ref supplied in the request, so results can be re-keyed. */
  ref: z.string(),
  /** Chart of accounts code. 0 = Unknown, which is always a permitted answer. */
  accountCode: z.number().int(),
  gstTreatment: z.enum(GST_TREATMENT_VALUES),
  /** 0..1 — validated after parsing, not in the schema. */
  confidence: z.number(),
  /** One short sentence an accountant can audit. */
  reason: z.string(),
  /** True when the model is not confident enough to auto-process. */
  needsReview: z.boolean(),
  /** The supplier as the model reads it from the narration, or null. Display and memory only. */
  vendor: z.string().nullable(),
  /** The nature of the supply in plain words ("Software subscription"), or null. */
  category: z.string().nullable(),
  /**
   * Set only with `accountCode: 0`: the model found no suitable account and
   * proposes one. The backend validates and may reuse an existing account
   * instead. Null whenever an existing account was chosen or the model abstained.
   */
  proposedAccount: ProposedAccountSchema.nullable(),
});

export const ClassificationBatchSchema = z.object({
  results: z.array(ClassificationResultSchema),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
export type ClassificationBatch = z.infer<typeof ClassificationBatchSchema>;
export type ProposedAccount = z.infer<typeof ProposedAccountSchema>;

/** One transaction presented to the model. Deliberately minimal — see PII rules. */
export interface ClassificationInputTx {
  ref: string;
  /** Masked before it reaches a provider — see `maskDescription` in prompt.ts. */
  description: string;
  amountCents: number;
  date: string; // ISO yyyy-mm-dd
  /**
   * The bank's own enrichment category, when the row came from a live feed.
   *
   * Weak corroborating evidence about the merchant, and the prompt says so
   * explicitly: it is a CONSUMER spending taxonomy, not a chart of accounts,
   * and it knows nothing about this client's industry or business use. It
   * never outranks coding memory and is never evidence about GST.
   */
  feedCategory?: string | null;
  feedSubcategory?: string | null;
  /** ISO 18245 merchant category code from the feed, when present. A standard, unlike the category. */
  merchantCode?: string | null;
}

export interface CandidateAccount {
  code: number;
  name: string;
  type: string;
  gstTreatment: GstTreatment;
  description?: string | null;
}

export interface MemoryHint {
  pattern: string;
  accountCode: number;
  gstTreatment: GstTreatment;
}

export interface ClassificationInput {
  transactions: ClassificationInputTx[];
  client: {
    industry: string | null;
    entityType: string;
    gstRegistered: boolean;
  };
  /** The whole chart the client may post to. Every proposal is validated against it. */
  accounts: CandidateAccount[];
  memory: MemoryHint[];
  /**
   * Candidate generation: the codes this client's people have actually used —
   * reviewed codings, memory targets, rule targets. Shown to the model as the
   * short list to prefer. Never a restriction: the chart above stays the
   * universe, the gate validates against it, and Unknown is always allowed.
   */
  candidateCodes?: number[];
}

export interface ProviderMeta {
  provider: string;
  model: string;
  promptVersion: string;
  /** SHA-256 of exactly what was sent, so a decision can be tied to its input. */
  inputHash?: string;
  /** Populated when the provider reports usage. */
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Cached-prefix counters. Reported separately from `inputTokens`, which
   * counts only uncached input — a lineage record that drops these
   * under-reports what the batch actually cost to run.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderFailure {
  kind: "refusal" | "invalid_output" | "error";
  detail: string;
}

export interface ClassificationResponse {
  results: ClassificationResult[];
  meta: ProviderMeta;
  /**
   * Set when the provider declined or failed. The caller routes the whole
   * batch to human review — never to a default coding.
   */
  failure?: ProviderFailure;
}

/* -------------------------------------------------------------------------- */
/* Subcontractor identification                                               */
/* -------------------------------------------------------------------------- */

/**
 * A proposal that a payment went to a subcontractor. The model matches a
 * payment to one on the register, or proposes a name for one that is not.
 * A person confirms; nothing is created or linked by the model.
 */
export const SubcontractorResultSchema = z.object({
  ref: z.string(),
  /** The id of a known subcontractor from the supplied register, or null. */
  knownId: z.string().nullable(),
  /** A trading name to add, when the payee is not on the register. */
  proposedName: z.string().nullable(),
  /** 0..1 — validated after parsing. */
  confidence: z.number(),
  reason: z.string(),
});

export const SubcontractorBatchSchema = z.object({
  results: z.array(SubcontractorResultSchema),
});

export type SubcontractorResult = z.infer<typeof SubcontractorResultSchema>;

export interface SubcontractorInput {
  transactions: { ref: string; description: string; amountCents: number; date: string }[];
  /** The client's register, so the model links rather than duplicates. */
  known: { id: string; name: string; abn: string | null }[];
  client: { industry: string | null };
}

export interface SubcontractorResponse {
  results: SubcontractorResult[];
  meta: ProviderMeta;
  failure?: ProviderFailure;
}

export interface AccountingAIProvider {
  readonly name: string;
  readonly model: string;
  classifyTransactions(input: ClassificationInput): Promise<ClassificationResponse>;
  identifySubcontractors(input: SubcontractorInput): Promise<SubcontractorResponse>;
  /** The second opinion on what `classifyTransactions` proposed. See the review section below. */
  reviewClassifications(input: ReviewInput): Promise<ReviewResponse>;
}

/**
 * Post-parse validation the schema cannot express.
 * Anything failing here is forced to review rather than discarded.
 */
export type RawClassificationResult = Omit<ClassificationResult, "vendor" | "category" | "proposedAccount"> &
  Partial<Pick<ClassificationResult, "vendor" | "category" | "proposedAccount">>;

export function sanitiseResult(r: RawClassificationResult): ClassificationResult {
  const confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const text = (value: string | null | undefined, max: number): string | null => {
    const trimmed = value?.trim().slice(0, max);
    return trimmed ? trimmed : null;
  };
  // A proposal only means something alongside Unknown: a model that names an
  // existing account AND proposes a new one has contradicted itself, and the
  // existing account is the answer that can be validated.
  const proposal = r.accountCode === 0 && r.proposedAccount ? r.proposedAccount : null;
  const proposalName = proposal ? text(proposal.name, 120) : null;
  return {
    ...r,
    confidence,
    // A model that returns Unknown, or an out-of-range confidence, always reviews.
    needsReview: r.needsReview || r.accountCode === 0 || confidence <= 0,
    vendor: text(r.vendor, 120),
    category: text(r.category, 120),
    proposedAccount: proposal && proposalName ? { ...proposal, name: proposalName } : null,
  };
}

/** Same discipline for subcontractor proposals: clamp, and never both a known id and a new name. */
export function sanitiseSubcontractor(r: SubcontractorResult): SubcontractorResult {
  const confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const proposedName = r.knownId ? null : (r.proposedName?.trim().slice(0, 120) || null);
  return { ...r, confidence, proposedName };
}

/* -------------------------------------------------------------------------- */
/* Classification review — the second opinion                                 */
/* -------------------------------------------------------------------------- */

/**
 * The reviewer tier. A separate call with a separate prompt challenges what
 * the classifier proposed, the way a partner reviews a junior's coding before
 * it is accepted. It sees more than the classifier did — the client's
 * signed-off history above all — and answers one question per row: would an
 * experienced accountant sign this coding as it stands?
 *
 * Its verdict is still a proposal. Deterministic rules validate it, a hard
 * risk factor still outranks it, and a person can always overrule it. What it
 * may do is clear the reasons a row would otherwise wait for a person: the
 * classifier's confidence gap, a first-time merchant, an account created
 * from a proposal. See `reconcile/reviewer.ts` for exactly which.
 */
export const REVIEW_VERDICTS = ["AGREE", "DISAGREE", "ESCALATE"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const ReviewResultSchema = z.object({
  /** Echoes the transaction ref supplied in the request. */
  ref: z.string(),
  verdict: z.enum(REVIEW_VERDICTS),
  /** 0..1, the reviewer's own confidence that the coding is correct as it stands. Validated after parsing. */
  confidence: z.number(),
  /** One short sentence naming the evidence, for the accountant who reads the row. */
  reason: z.string(),
  /** DISAGREE only: the account the reviewer would code to instead, from the supplied chart. */
  suggestedAccountCode: z.number().int().nullable(),
  suggestedGstTreatment: z.enum(GST_TREATMENT_VALUES).nullable(),
});

export const ReviewBatchSchema = z.object({
  results: z.array(ReviewResultSchema),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** One proposed coding presented to the reviewer, with the evidence around it. */
export interface ReviewInputTx {
  ref: string;
  /** Masked before it reaches a provider, like the classifier's input. */
  description: string;
  amountCents: number;
  date: string; // ISO yyyy-mm-dd
  /** What the classifier proposed, as the gate accepted it. */
  proposal: {
    accountCode: number;
    accountName: string;
    gstTreatment: GstTreatment;
    confidence: number;
    reason: string;
    vendor: string | null;
    category: string | null;
  };
  /**
   * Set when the classifier found nothing in the chart and proposed this
   * account. The reviewer judges the proposal as well as the coding: the
   * account has not been created yet when the reviewer sees it.
   */
  proposedAccount: ProposedAccount | null;
  /** Why the classifier asked for a person, when it did. */
  classifierConcern: string | null;
  /** Nobody has reviewed this merchant for the client before. */
  firstSeen: boolean;
  feedCategory?: string | null;
  feedSubcategory?: string | null;
  merchantCode?: string | null;
}

/** A transaction a person has signed off for this client: the strongest evidence a reviewer has. */
export interface ReviewHistoryRow {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amountCents: number;
  accountCode: number;
  gstTreatment: GstTreatment;
}

export interface ReviewInput {
  transactions: ReviewInputTx[];
  client: ClassificationInput["client"];
  /** The whole chart the client may post to. A suggestion outside it is refused by the gate. */
  accounts: CandidateAccount[];
  memory: MemoryHint[];
  /** Most recent first. */
  history: ReviewHistoryRow[];
}

export interface ReviewResponse {
  results: ReviewResult[];
  meta: ProviderMeta;
  /** Set when the provider declined or failed. The rows keep the routing the classifier gave them. */
  failure?: ProviderFailure;
}

/**
 * Post-parse discipline for a verdict: clamp the confidence, and refuse a
 * verdict that contradicts itself. An AGREE that also suggests a different
 * account is not an agreement; an AGREE at no confidence is not one either.
 * Both become ESCALATE, which a person resolves.
 */
export function sanitiseReview(r: ReviewResult): ReviewResult {
  const confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const reason = r.reason.trim().slice(0, 300);
  if (r.verdict === "AGREE") {
    const contradicts = r.suggestedAccountCode !== null || r.suggestedGstTreatment !== null;
    if (contradicts || confidence <= 0) {
      return { ...r, verdict: "ESCALATE", confidence, reason, suggestedAccountCode: null, suggestedGstTreatment: null };
    }
    return { ...r, confidence, reason, suggestedAccountCode: null, suggestedGstTreatment: null };
  }
  if (r.verdict === "ESCALATE") {
    return { ...r, confidence, reason, suggestedAccountCode: null, suggestedGstTreatment: null };
  }
  return { ...r, confidence, reason };
}

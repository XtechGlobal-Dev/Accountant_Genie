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
});

export const ClassificationBatchSchema = z.object({
  results: z.array(ClassificationResultSchema),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
export type ClassificationBatch = z.infer<typeof ClassificationBatchSchema>;

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
}

/**
 * Post-parse validation the schema cannot express.
 * Anything failing here is forced to review rather than discarded.
 */
export function sanitiseResult(r: ClassificationResult): ClassificationResult {
  const confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  return {
    ...r,
    confidence,
    // A model that returns Unknown, or an out-of-range confidence, always reviews.
    needsReview: r.needsReview || r.accountCode === 0 || confidence <= 0,
  };
}

/** Same discipline for subcontractor proposals: clamp, and never both a known id and a new name. */
export function sanitiseSubcontractor(r: SubcontractorResult): SubcontractorResult {
  const confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const proposedName = r.knownId ? null : (r.proposedName?.trim().slice(0, 120) || null);
  return { ...r, confidence, proposedName };
}

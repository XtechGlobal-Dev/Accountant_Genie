import type { GstTreatment } from "@/shared/enums";
import type { ReviewResult, ReviewVerdict } from "@/server/ai/types";

/**
 * How a reviewer verdict routes a row — pure, so a test can pin it.
 *
 * The reviewer is the second opinion on an AI coding. Its AGREE, at or above
 * the configured confidence, stands in for the first look a person would
 * otherwise give the row, and clears exactly these reasons for review:
 *
 *   - the classifier's confidence was below the auto-accept threshold
 *   - the classifier itself asked for a person (the reviewer has judged
 *     whether that concern can be settled, and said it can)
 *   - the merchant has never been reviewed for this client (novelty)
 *   - the row is coded to an account created from a proposal in this run
 *     (the reviewer has judged the proposal)
 *
 * It clears nothing else. A large amount, a capital or balance-sheet posting,
 * a coding that contradicts what a person decided before, a treatment that
 * differs from the account's default, and a journal that will not balance
 * all still wait for a person, whatever the reviewer says — see the routing
 * in engine.ts. And a DISAGREE or an ESCALATE always sends the row to a
 * person, even one the classifier was sure about: that is the reviewer
 * catching a confident mistake, which is the whole point of a second look.
 */
export interface ReviewerJudgement {
  verdict: ReviewVerdict;
  confidence: number;
  reason: string;
  suggestedAccountCode: number | null;
  suggestedGstTreatment: GstTreatment | null;
  /** The AGREE is confident enough to stand in for a person's first look. */
  cleared: boolean;
}

export function judgeReview(result: ReviewResult, threshold: number): ReviewerJudgement {
  return {
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
    suggestedAccountCode: result.suggestedAccountCode,
    suggestedGstTreatment: result.suggestedGstTreatment,
    cleared: result.verdict === "AGREE" && result.confidence >= threshold,
  };
}

/** The class of reason the upload dialog counts, or null when the verdict does not itself send the row to a person. */
export function reviewerReviewReason(j: ReviewerJudgement): string | null {
  if (j.verdict === "DISAGREE") return "AI reviewer disagrees with the coding";
  if (j.verdict === "ESCALATE") return "AI reviewer asked for a person";
  return j.cleared ? null : "AI reviewer not confident enough";
}

/** What is appended to the row's own reasoning, so the review screen shows both opinions. */
export function reviewerNote(j: ReviewerJudgement, suggested: { code: number; name: string } | null, threshold: number): string {
  const pct = j.confidence.toFixed(2);
  switch (j.verdict) {
    case "AGREE":
      return j.cleared
        ? `AI reviewer agreed (${pct}): ${j.reason}`
        : `AI reviewer agreed at ${pct}, below the ${threshold.toFixed(2)} threshold: ${j.reason}`;
    case "DISAGREE": {
      const alternative = suggested
        ? ` — suggests ${suggested.code} ${suggested.name}${j.suggestedGstTreatment ? ` (${j.suggestedGstTreatment})` : ""}`
        : j.suggestedAccountCode !== null
          ? ` — suggests account ${j.suggestedAccountCode}, which this client cannot post to`
          : "";
      return `AI reviewer disagrees: ${j.reason}${alternative}`;
    }
    case "ESCALATE":
      return `AI reviewer: ${j.reason}`;
  }
}

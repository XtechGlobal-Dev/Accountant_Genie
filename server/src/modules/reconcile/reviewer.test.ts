import { describe, expect, it } from "vitest";
import { sanitiseReview, type ReviewResult } from "@/server/ai/types";
import { judgeReview, reviewerNote, reviewerReviewReason } from "./reviewer";

/**
 * The reviewer's routing is what decides whether an AI coding reaches Ready
 * without a person. These pin the boundary: a confident AGREE clears, and
 * nothing else does.
 */

const THRESHOLD = 0.95;

function result(over: Partial<ReviewResult>): ReviewResult {
  return { ref: "t1", verdict: "AGREE", confidence: 0.97, reason: "matches history", suggestedAccountCode: null, suggestedGstTreatment: null, ...over };
}

describe("judgeReview", () => {
  it("clears only a confident AGREE", () => {
    expect(judgeReview(result({}), THRESHOLD).cleared).toBe(true);
    expect(judgeReview(result({ confidence: 0.95 }), THRESHOLD).cleared).toBe(true);
    expect(judgeReview(result({ confidence: 0.94 }), THRESHOLD).cleared).toBe(false);
    expect(judgeReview(result({ verdict: "DISAGREE", confidence: 1 }), THRESHOLD).cleared).toBe(false);
    expect(judgeReview(result({ verdict: "ESCALATE", confidence: 1 }), THRESHOLD).cleared).toBe(false);
  });

  it("carries the suggestion through for a DISAGREE", () => {
    const j = judgeReview(result({ verdict: "DISAGREE", suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES" }), THRESHOLD);
    expect(j).toMatchObject({ verdict: "DISAGREE", suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES", cleared: false });
  });
});

describe("reviewerReviewReason", () => {
  it("names the verdict for the upload dialog, and nothing for a cleared row", () => {
    expect(reviewerReviewReason(judgeReview(result({}), THRESHOLD))).toBeNull();
    expect(reviewerReviewReason(judgeReview(result({ confidence: 0.8 }), THRESHOLD))).toBe("AI reviewer not confident enough");
    expect(reviewerReviewReason(judgeReview(result({ verdict: "DISAGREE" }), THRESHOLD))).toBe("AI reviewer disagrees with the coding");
    expect(reviewerReviewReason(judgeReview(result({ verdict: "ESCALATE" }), THRESHOLD))).toBe("AI reviewer asked for a person");
  });
});

describe("reviewerNote", () => {
  it("shows both opinions on a disagreement, naming the suggested account when the client can post to it", () => {
    const j = judgeReview(result({ verdict: "DISAGREE", confidence: 0.9, reason: "stationery, not software", suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES" }), THRESHOLD);
    expect(reviewerNote(j, { code: 450, name: "Office Supplies" }, THRESHOLD)).toBe(
      "AI reviewer disagrees: stationery, not software — suggests 450 Office Supplies (GST_ON_EXPENSES)",
    );
    // A suggestion outside the client's chart is reported, never applied.
    expect(reviewerNote(j, null, THRESHOLD)).toBe("AI reviewer disagrees: stationery, not software — suggests account 450, which this client cannot post to");
  });

  it("says when an agreement fell short of the threshold", () => {
    expect(reviewerNote(judgeReview(result({}), THRESHOLD), null, THRESHOLD)).toBe("AI reviewer agreed (0.97): matches history");
    expect(reviewerNote(judgeReview(result({ confidence: 0.8 }), THRESHOLD), null, THRESHOLD)).toBe(
      "AI reviewer agreed at 0.80, below the 0.95 threshold: matches history",
    );
    expect(reviewerNote(judgeReview(result({ verdict: "ESCALATE", reason: "could be private" }), THRESHOLD), null, THRESHOLD)).toBe("AI reviewer: could be private");
  });
});

describe("sanitiseReview", () => {
  it("turns a self-contradicting or empty AGREE into an ESCALATE", () => {
    // An AGREE that also suggests a different account is not an agreement.
    expect(sanitiseReview(result({ suggestedAccountCode: 450 }))).toMatchObject({ verdict: "ESCALATE", suggestedAccountCode: null });
    expect(sanitiseReview(result({ confidence: 0 }))).toMatchObject({ verdict: "ESCALATE" });
    expect(sanitiseReview(result({ confidence: Number.NaN }))).toMatchObject({ verdict: "ESCALATE", confidence: 0 });
  });

  it("clamps confidence and drops a suggestion from an ESCALATE", () => {
    expect(sanitiseReview(result({ confidence: 1.7 }))).toMatchObject({ verdict: "AGREE", confidence: 1 });
    expect(sanitiseReview(result({ verdict: "ESCALATE", suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES" }))).toMatchObject({
      verdict: "ESCALATE",
      suggestedAccountCode: null,
      suggestedGstTreatment: null,
    });
    const disagree = sanitiseReview(result({ verdict: "DISAGREE", confidence: -2, suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES" }));
    expect(disagree).toMatchObject({ verdict: "DISAGREE", confidence: 0, suggestedAccountCode: 450 });
  });
});

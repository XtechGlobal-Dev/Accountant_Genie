import type { AccountType, GstTreatment } from "@/shared/enums";
import type { ReconcileConfig } from "./config";

/**
 * Risk, scored separately from confidence.
 *
 * A $10 office expense at 0.97 confidence can be auto-coded. A $50,000
 * payment to a supplier nobody has seen before at 0.97 confidence cannot —
 * the cost of being wrong is not symmetrical. Risk is what carries that
 * asymmetry into the routing decision.
 *
 * Five factors, as the skill lists them: amount · novelty · tax impact ·
 * account type · historical inconsistency.
 */

export type RiskLevel = "LOW" | "HIGH";

export interface RiskInput {
  amountCents: number;
  /** The merchant has never been reviewed by a person for this client. */
  novel: boolean;
  /**
   * A person has reviewed this merchant before and coded it somewhere else.
   * The proposal contradicts the firm's own history, which is exactly the
   * drift a reviewer has to see.
   */
  inconsistent: boolean;
  gstTreatment: GstTreatment;
  accountType: AccountType;
}

export type RiskFactor = "AMOUNT" | "CAPITAL" | "BALANCE_SHEET" | "INCONSISTENT" | "NOVEL";

/**
 * The first factor that makes a decision high risk, or null when none does.
 * The order is the order of the checks in `scoreRisk`; the level is derived
 * from this so the two can never disagree.
 */
export function riskFactor(
  input: RiskInput,
  config: Pick<ReconcileConfig, "highRiskCents" | "noveltyRiskCents">,
): RiskFactor | null {
  if (Math.abs(input.amountCents) >= config.highRiskCents) return "AMOUNT";
  // Capital, equity and liability postings change the balance sheet, not
  // just the period's expenses; a mistake there survives the year end.
  if (input.gstTreatment === "GST_ON_CAPITAL" || input.gstTreatment === "GST_FREE_CAPITAL") {
    return "CAPITAL";
  }
  if (input.accountType === "EQUITY" || input.accountType === "LIABILITY") return "BALANCE_SHEET";
  if (input.inconsistent) return "INCONSISTENT";
  if (input.novel && Math.abs(input.amountCents) >= config.noveltyRiskCents) return "NOVEL";
  return null;
}

export function scoreRisk(
  input: RiskInput,
  config: Pick<ReconcileConfig, "highRiskCents" | "noveltyRiskCents">,
): RiskLevel {
  return riskFactor(input, config) === null ? "LOW" : "HIGH";
}

/** What a reviewer is told about a high-risk factor. */
export const RISK_FACTOR_REASONS: Record<RiskFactor, string> = {
  AMOUNT: "Large amount",
  CAPITAL: "Capital purchase — affects the balance sheet",
  BALANCE_SHEET: "Posts to a balance sheet account",
  INCONSISTENT: "Coded differently by a person before",
  NOVEL: "First time this supplier has been seen for the client",
};

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

export function scoreRisk(
  input: RiskInput,
  config: Pick<ReconcileConfig, "highRiskCents" | "noveltyRiskCents">,
): RiskLevel {
  if (Math.abs(input.amountCents) >= config.highRiskCents) return "HIGH";
  // Capital, equity and liability postings change the balance sheet, not
  // just the period's expenses; a mistake there survives the year end.
  if (input.gstTreatment === "GST_ON_CAPITAL" || input.gstTreatment === "GST_FREE_CAPITAL") {
    return "HIGH";
  }
  if (input.accountType === "EQUITY" || input.accountType === "LIABILITY") return "HIGH";
  if (input.inconsistent) return "HIGH";
  if (input.novel && Math.abs(input.amountCents) >= config.noveltyRiskCents) return "HIGH";
  return "LOW";
}

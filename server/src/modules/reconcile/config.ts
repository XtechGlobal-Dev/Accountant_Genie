/**
 * Reconciliation thresholds. Configuration, not constants: every number here
 * is read from the environment with a documented default, so tuning the
 * engine is a deployment change and never a code change.
 *
 * See .claude/skills/reconciliation-engine/SKILL.md.
 */

export interface ReconcileConfig {
  /**
   * Below this the AI's answer is treated as Unknown.
   *
   * The skill's indicative bands put the review boundary at 0.80; this floor
   * sits at 0.75 on purpose. Between the floor and `autoConfidence` a coding
   * is kept but ALWAYS routed to review, so the floor only decides whether a
   * reviewer sees the model's suggestion or an empty Unknown — a suggestion
   * at 0.77 is more useful to a person than a blank. Nothing in that band is
   * ever auto-processed.
   */
  confidenceFloor: number;
  /** At or above this, with low risk, a coding needs no human look before sign-off. */
  autoConfidence: number;
  /** An absolute amount at or above this is high risk regardless of confidence. */
  highRiskCents: number;
  /** A merchant nobody has reviewed for this client is high risk from this amount. */
  noveltyRiskCents: number;
  /**
   * The share of transactions memory and rules should resolve before any AI
   * call. Below it the run is flagged: the fix is more rules, not a better
   * prompt.
   */
  preAiTarget: number;
  /** Transactions per AI request. */
  batchSize: number;
  /**
   * How many accounts one run may create from AI proposals. A file that
   * wants more than this is describing a chart problem, not a coding one,
   * and the rest of its proposals go to review with the proposal attached.
   */
  maxNewAccountsPerRun: number;
  /**
   * Whether the AI reviewer tier runs over what the classifier proposed.
   * Off, every AI coding routes on the classifier's confidence and the risk
   * score alone, as before the reviewer existed.
   */
  reviewerEnabled: boolean;
  /**
   * The reviewer's own confidence at or above which an AGREE clears the
   * reasons a row would otherwise wait for a person. Below it an AGREE is
   * recorded but the row still goes to review.
   */
  reviewerConfidence: number;
}

/** Version stamp stored with every decision the rules tier makes. */
export const RULES_VERSION = "rules-v1";

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function reconcileConfig(): ReconcileConfig {
  return {
    confidenceFloor: num("RECONCILE_CONFIDENCE_FLOOR", 0.75),
    autoConfidence: num("RECONCILE_AUTO_CONFIDENCE", 0.95),
    highRiskCents: num("RECONCILE_HIGH_RISK_CENTS", 500_000),
    // $2,500. Novelty applies to AI-tier decisions only (a rule or memory hit
    // is the firm's own policy), and "Ready" still means a person clicks
    // Accept: the earlier $500 sent every first-time supplier on a new
    // client to review, so a fresh client could never have a Ready row.
    noveltyRiskCents: num("RECONCILE_NOVELTY_RISK_CENTS", 250_000),
    preAiTarget: Math.min(1, Math.max(0, num("RECONCILE_PRE_AI_TARGET", 0.6))),
    batchSize: Math.max(1, Math.min(100, num("RECONCILE_BATCH_SIZE", 40))),
    maxNewAccountsPerRun: Math.max(0, Math.min(50, num("RECONCILE_MAX_NEW_ACCOUNTS", 5))),
    reviewerEnabled: flag("RECONCILE_REVIEWER", true),
    reviewerConfidence: Math.min(1, Math.max(0, num("RECONCILE_REVIEWER_CONFIDENCE", 0.95))),
  };
}

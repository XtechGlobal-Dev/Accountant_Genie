/**
 * Reconciliation thresholds. Configuration, not constants: every number here
 * is read from the environment with a documented default, so tuning the
 * engine is a deployment change and never a code change.
 *
 * See .claude/skills/reconciliation-engine/SKILL.md.
 */

export interface ReconcileConfig {
  /** Below this the AI's answer is treated as Unknown. */
  confidenceFloor: number;
  /** At or above this, with low risk, a coding needs no human look before sign-off. */
  autoConfidence: number;
  /** An absolute amount at or above this is high risk regardless of confidence. */
  highRiskCents: number;
  /** Transactions per AI request. */
  batchSize: number;
}

/** Version stamp stored with every decision the rules tier makes. */
export const RULES_VERSION = "rules-v1";

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
    batchSize: Math.max(1, Math.min(100, num("RECONCILE_BATCH_SIZE", 40))),
  };
}

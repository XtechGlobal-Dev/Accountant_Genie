import type { GstTreatment, MatchType } from "@/shared/enums";

/**
 * Coding Memory lookup — pure.
 *
 * Client-scoped rules beat firm-scoped ones; an exact match beats a
 * contains-match; a longer pattern beats a shorter one. So "bunnings
 * warehouse" wins over "bunnings", and what this firm decided for this client
 * wins over what it decided for everyone.
 */

export interface MemoryCandidate {
  id: string;
  /** null = firm-wide */
  clientId: string | null;
  matchType: MatchType;
  pattern: string;
  accountId: string;
  gstTreatment: GstTreatment;
  evidenceCount: number;
}

export function matchMemory(
  rules: readonly MemoryCandidate[],
  normalised: string,
): MemoryCandidate | null {
  let best: MemoryCandidate | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (pattern === "") continue;
    const hit =
      rule.matchType === "EXACT" ? normalised === pattern : normalised.includes(pattern);
    if (!hit) continue;

    const score =
      (rule.clientId ? 1_000_000 : 0) +
      (rule.matchType === "EXACT" ? 100_000 : 0) +
      pattern.length;
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

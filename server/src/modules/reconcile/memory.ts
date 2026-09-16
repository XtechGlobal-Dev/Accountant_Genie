import type { GstTreatment, MatchType } from "@/shared/enums";

/**
 * Coding Memory lookup — pure.
 *
 * Client-scoped rules beat firm-scoped ones; an exact match beats a
 * contains-match; a longer pattern beats a shorter one; and between two rules
 * that tie on all of that, the one more corrections have taught wins. So
 * "bunnings warehouse" wins over "bunnings", and what this firm decided for
 * this client wins over what it decided for everyone.
 */

export interface MemoryCandidate {
  id: string;
  /** null = firm-wide */
  clientId: string | null;
  matchType: MatchType;
  pattern: string;
  accountId: string;
  gstTreatment: GstTreatment;
  /** How many human corrections taught this rule. Repeats raise its standing. */
  evidenceCount: number;
}

/** The score a rule gets for a normalised description it matches — exported for tests. */
export function memoryScore(rule: MemoryCandidate, patternLength: number): number {
  return (
    (rule.clientId ? 1_000_000 : 0) +
    (rule.matchType === "EXACT" ? 100_000 : 0) +
    patternLength * 100 +
    Math.min(Math.max(rule.evidenceCount, 1), 99)
  );
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

    const score = memoryScore(rule, pattern.length);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

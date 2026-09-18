import type { AccountType, GstTreatment } from "@/shared/enums";
import { CUSTOM_ACCOUNT_CODE_CEILING, CUSTOM_ACCOUNT_CODE_FLOOR, type CreatableAccountType } from "@/shared/account-rules";

/**
 * The account resolver — pure.
 *
 * The AI may say "this is a software subscription" and, when the chart has
 * nowhere to put one, propose an account by that name. It never chooses a
 * code, and it never decides whether the chart already covers the supply:
 * both are this module's job, because both are where account explosion
 * starts. "Adobe Expense", "Canva Expense" and "Slack Expense" are one
 * account, and a chart that already has "Subscriptions" does not need
 * "Software Subscriptions" beside it.
 *
 * Two questions, answered deterministically so a test can pin them:
 *   1. Does an existing account already mean what the proposal means?
 *   2. If not, what code does the new one get?
 */

export interface ResolvableAccount {
  id: string;
  code: number;
  name: string;
  type: AccountType;
  gstTreatment: GstTreatment;
  description?: string | null;
}

export interface AccountProposal {
  name: string;
  type: CreatableAccountType;
  gstTreatment: GstTreatment;
}

/* -------------------------------------------------------------------------- */
/* Name similarity                                                            */
/* -------------------------------------------------------------------------- */

/** Words that describe every account and distinguish none. */
const STOP = new Set(["and", "or", "of", "the", "for", "on", "in", "to", "a", "an", "other", "general", "misc", "miscellaneous", "expense", "expenses", "cost", "costs", "income", "revenue", "business"]);

/**
 * A proposal's word and the chart's word for the same thing. Small and
 * literal on purpose: every entry here widens what "already exists" means,
 * and a false match codes a supply to the wrong account silently.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  utilities: ["electricity", "gas", "water", "power"],
  utility: ["electricity", "gas", "water", "power"],
  software: ["subscriptions", "subscription"],
  saas: ["subscriptions", "subscription", "software"],
  phone: ["telephone", "mobile"],
  telephone: ["phone"],
  vehicle: ["motor"],
  car: ["motor", "vehicle"],
  salaries: ["wages", "salary"],
  salary: ["wages"],
  payroll: ["wages"],
  stationery: ["office", "supplies"],
  advertising: ["marketing"],
  marketing: ["advertising"],
  accounting: ["bookkeeping"],
  bookkeeping: ["accounting"],
};

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The distinguishing words of an account or proposal name, stemmed. Exported for tests. */
export function nameTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

function expand(tokens: Set<string>): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) for (const s of SYNONYMS[t] ?? []) out.add(stem(s));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/** Below this an account is a different thing, not a near-name. */
export const SIMILARITY_THRESHOLD = 0.5;

/**
 * The similarity of a proposal to one account, 0..1. Exported for tests.
 *
 * Name-to-name overlap counts in full (Jaccard over stemmed, synonym-expanded
 * tokens, or containment when one name is wholly inside the other). Words the
 * proposal shares only with the account's description count for half: a
 * description says what the account is for, which is evidence, but a weaker
 * kind than the name.
 */
export function accountSimilarity(account: ResolvableAccount, proposal: AccountProposal): number {
  const wanted = expand(nameTokens(proposal.name));
  if (wanted.size === 0) return 0;
  const name = nameTokens(account.name);
  if (name.size === 0) return 0;

  const shared = overlap(wanted, name);
  if (shared > 0 && (shared === name.size || shared === wanted.size)) return 1;
  const union = new Set([...wanted, ...name]).size;
  const jaccard = shared / union;

  const described = nameTokens(account.description ?? "");
  const viaDescription = described.size > 0 ? overlap(wanted, described) / wanted.size : 0;

  return Math.max(jaccard, viaDescription * 0.5 + jaccard * 0.5);
}

/**
 * The existing account a proposal already means, or null. Only accounts of
 * the same type are candidates: an income account can never stand in for an
 * expense proposal however similar the names, because the P&L side differs.
 */
export function findSimilarAccount(
  chart: readonly ResolvableAccount[],
  proposal: AccountProposal,
): { account: ResolvableAccount; score: number } | null {
  let best: { account: ResolvableAccount; score: number } | null = null;
  for (const account of chart) {
    if (account.type !== proposal.type) continue;
    const score = accountSimilarity(account, proposal);
    if (score >= SIMILARITY_THRESHOLD && (best === null || score > best.score || (score === best.score && account.code < best.account.code))) {
      best = { account, score };
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Code allocation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where a firm's own accounts of each type live, inside the custom range.
 * The bands mirror the order of the system chart (income, then expenses,
 * then the balance sheet) so a report sorted by code still reads top to
 * bottom, and a gap of ten between allocated codes leaves room for a person
 * to slot a related account in by hand.
 */
export const CUSTOM_CODE_BANDS: Record<CreatableAccountType, { from: number; to: number }> = {
  INCOME: { from: 1200, to: 1299 },
  COGS: { from: 1300, to: 1399 },
  EXPENSE: { from: 1400, to: 1699 },
  ASSET: { from: 1700, to: 1799 },
  LIABILITY: { from: 1800, to: 1899 },
  EQUITY: { from: 1900, to: 1999 },
};

const CODE_STEP = 10;

/**
 * The next free code for a new account of this type, or null when the band
 * is full. Prefers the first free multiple of ten in the band, then any free
 * code in it. `taken` is every code the firm can see — system, firm-wide and
 * client-scoped — because the chart is one namespace to the person reading it.
 */
export function nextCustomCode(taken: Iterable<number>, type: CreatableAccountType): number | null {
  const used = new Set(taken);
  const band = CUSTOM_CODE_BANDS[type];
  if (band.from < CUSTOM_ACCOUNT_CODE_FLOOR || band.to > CUSTOM_ACCOUNT_CODE_CEILING) {
    throw new Error(`Custom code band for ${type} lies outside the custom range`);
  }
  for (let code = band.from; code <= band.to; code += CODE_STEP) {
    if (!used.has(code)) return code;
  }
  for (let code = band.from; code <= band.to; code += 1) {
    if (!used.has(code)) return code;
  }
  return null;
}

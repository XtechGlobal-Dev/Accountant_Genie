/**
 * The tax rules the software depends on, named once.
 *
 * Nothing here carries a figure. The values are supplied and verified by the
 * firm's registered tax advisor through the settings page, versioned with
 * effective dates, and never updated in place. A rule with no verified
 * version is not applied — the report says so rather than guessing.
 *
 * Every rule is scoped to a firm: the advisor who signs it off is accountable
 * for that firm's reports and nobody else's. New firms receive the mapping
 * proposals below as PENDING, never as verified.
 *
 * This file has no server-only import on purpose: the seed script reads it.
 *
 * See .claude/skills/au-tax-rules/SKILL.md.
 */

export type TaxRuleKind = "AMOUNT" | "TEXT";

export interface TaxRuleDefinition {
  code: string;
  label: string;
  description: string;
  kind: TaxRuleKind;
  /** A starting proposal for a mapping rule, shown as pending — never as verified. */
  proposedText?: string;
}

export const TAX_RULES: readonly TaxRuleDefinition[] = [
  {
    code: "INSTANT_ASSET_WRITE_OFF",
    label: "Instant asset write-off threshold",
    description:
      "Assets costing up to this amount, bought while the rule is in effect, are deducted in full in the year of purchase instead of depreciated. Applied by the depreciation schedule only when verified.",
    kind: "AMOUNT",
  },
  {
    code: "CAR_LIMIT",
    label: "Car limit for depreciation",
    description:
      "The maximum cost that can be depreciated for a car. Applied to assets marked as cars only when verified.",
    kind: "AMOUNT",
  },
  {
    code: "DEPRECIATION_METHODS",
    label: "Depreciation method rates",
    description:
      "Prime cost at 100% ÷ effective life; diminishing value at 200% ÷ effective life for assets acquired after 10 May 2006 (150% before). The schedule reads its rates from the verified version; until one exists it uses these statutory figures and says so on the report.",
    kind: "TEXT",
    proposedText: "PRIME_COST=100%/life; DIMINISHING_VALUE=200%/life",
  },
  {
    code: "BAS_W1_ACCOUNTS",
    label: "BAS W1 — wages accounts",
    description:
      "Account codes whose postings make up W1 (total salary, wages and other payments). Comma-separated account codes.",
    kind: "TEXT",
    proposedText: "325,477",
  },
  {
    code: "BAS_W2_ACCOUNT",
    label: "BAS W2 — PAYG withholding account",
    description: "The liability account whose credits make up W2 (amounts withheld). One account code.",
    kind: "TEXT",
    proposedText: "825",
  },
  {
    code: "TPAR_ACCOUNTS",
    label: "TPAR — subcontractor payment accounts",
    description:
      "Account codes whose payments are reportable on the Taxable Payments Annual Report. Comma-separated account codes. Until verified the report uses the chart's Subcontractor Payments account and shows a badge.",
    kind: "TEXT",
    proposedText: "320",
  },
  {
    code: "INPUT_TAXED_BAS_LABELS",
    label: "BAS — input-taxed supplies at G1 and G11",
    description:
      "Whether input-taxed sales (residential rent, interest received) are included in G1 total sales and input-taxed purchases (bank fees, interest paid) in G11 non-capital purchases. The ATO's Simpler BAS instructions include them; until verified they are left out of both labels and the BAS says so.",
    kind: "TEXT",
    proposedText: "G1,G11",
  },
  {
    code: "INTEREST_INCOME_TREATMENT",
    label: "Interest income tax treatment",
    description:
      "Whether interest received is input taxed (a financial supply) or GST-free. Affects G1 for every client with a bank account. The chart's Interest Income account carries the same flag.",
    kind: "TEXT",
    proposedText: "INPUT_TAXED",
  },
  {
    code: "GST_RATE_PERCENT",
    label: "GST rate",
    description:
      "The rate the deterministic engine applies: GST = gross ÷ 11 at 10%. The arithmetic lives in one file (server/src/shared/gst-math.ts) and a rate change is a code change; this entry records the advisor's confirmation and is stamped on every posted journal as its rules version.",
    kind: "TEXT",
    proposedText: "10",
  },
];

export function ruleDefinition(code: string): TaxRuleDefinition | undefined {
  return TAX_RULES.find((rule) => rule.code === code);
}

/** The AU GST regime the arithmetic implements. Stamped on every journal entry. */
export const GST_RULES_VERSION = "gst-rate:10pct:2000-07-01";

/**
 * The proposals a new firm starts with: every rule that has a starting value,
 * as PENDING_VERIFICATION, effective from the start of GST. Nothing here is
 * ever applied until the firm's registered tax agent verifies it.
 */
export function seedProposals(): {
  code: string;
  label: string;
  description: string;
  valueText: string;
  effectiveFrom: Date;
  note: string;
}[] {
  return TAX_RULES.filter((rule) => rule.proposedText !== undefined).map((rule) => ({
    code: rule.code,
    label: rule.label,
    description: rule.description,
    valueText: rule.proposedText!,
    effectiveFrom: new Date("2000-07-01T00:00:00.000Z"),
    note: "Proposed from the chart of accounts and public ATO guidance. Not a tax opinion — verify or replace before relying on it.",
  }));
}

/* -------------------------------------------------------------------------- */
/* Parsers for TEXT rules — pure, so they are unit tested without a database  */
/* -------------------------------------------------------------------------- */

/** Account codes from a verified mapping rule, or the fallback when none is verified. */
export function parseCodes(valueText: string | null | undefined, fallback: readonly number[]): number[] {
  if (!valueText) return [...fallback];
  const codes = valueText
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0);
  return codes.length > 0 ? codes : [...fallback];
}

export interface DepreciationMethodRates {
  /** Whole percent of cost per year of effective life. 100 = prime cost. */
  primeCostPercent: number;
  /** Whole percent of the written-down value per year of effective life. 200 = diminishing value. */
  diminishingValuePercent: number;
}

/** The statutory rates for assets acquired after 10 May 2006 — the fallback when no version is verified. */
export const STATUTORY_DEPRECIATION_RATES: DepreciationMethodRates = {
  primeCostPercent: 100,
  diminishingValuePercent: 200,
};

/**
 * "PRIME_COST=100%/life; DIMINISHING_VALUE=200%/life" → the two percentages.
 * Anything unparseable yields null so the caller falls back and flags it,
 * rather than silently depreciating at a rate nobody typed.
 */
export function parseDepreciationMethods(valueText: string | null | undefined): DepreciationMethodRates | null {
  if (!valueText) return null;
  const pc = /PRIME_COST\s*=\s*(\d{1,3})\s*%/i.exec(valueText);
  const dv = /DIMINISHING_VALUE\s*=\s*(\d{1,3})\s*%/i.exec(valueText);
  if (!pc || !dv) return null;
  const primeCostPercent = Number(pc[1]);
  const diminishingValuePercent = Number(dv[1]);
  if (primeCostPercent <= 0 || diminishingValuePercent <= 0) return null;
  return { primeCostPercent, diminishingValuePercent };
}

export interface InputTaxedBasLabels {
  /** Whether input-taxed sales are counted at G1. */
  salesAtG1: boolean;
  /** Whether input-taxed purchases are counted at G11. */
  purchasesAtG11: boolean;
}

/** "G1,G11" → both; "G1" → sales only; "NONE" or unparseable → neither. */
export function parseInputTaxedBasLabels(valueText: string | null | undefined): InputTaxedBasLabels {
  const labels = new Set((valueText ?? "").toUpperCase().split(/[,\s]+/).filter(Boolean));
  return { salesAtG1: labels.has("G1"), purchasesAtG11: labels.has("G11") };
}

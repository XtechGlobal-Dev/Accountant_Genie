/**
 * The tax rules the software depends on, named once.
 *
 * Nothing here carries a figure. The values are supplied and verified by the
 * registered tax advisor through the settings page, versioned with effective
 * dates, and never updated in place. A rule with no verified version is not
 * applied — the report says so rather than guessing.
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
      "Prime cost at 100% ÷ effective life; diminishing value at 200% ÷ effective life for assets acquired after 10 May 2006. Confirms the formulas the schedule uses.",
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
    code: "INTEREST_INCOME_TREATMENT",
    label: "Interest income tax treatment",
    description:
      "Whether interest received is input taxed (a financial supply) or GST-free. Affects G1 for every client with a bank account. The chart's Interest Income account carries the same flag.",
    kind: "TEXT",
    proposedText: "INPUT_TAXED",
  },
];

export function ruleDefinition(code: string): TaxRuleDefinition | undefined {
  return TAX_RULES.find((rule) => rule.code === code);
}

/** Versioned tax rules and their verification state, as the settings page shows them. */

export type TaxRuleStatusKind = "PENDING_VERIFICATION" | "VERIFIED" | "SUPERSEDED";

export interface TaxRuleVersionView {
  id: string;
  code: string;
  label: string;
  description: string | null;
  valueCents: number | null;
  valueText: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: TaxRuleStatusKind;
  note: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

/** One rule, with its current version first and older versions after. */
export interface TaxRuleView {
  code: string;
  label: string;
  description: string | null;
  /** What the software applies today, if anything. */
  current: TaxRuleVersionView | null;
  versions: TaxRuleVersionView[];
  /** Whether the rule is an amount (cents) or a mapping (text). */
  kind: "AMOUNT" | "TEXT";
}

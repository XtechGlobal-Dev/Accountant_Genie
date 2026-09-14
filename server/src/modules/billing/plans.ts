/**
 * Plan definitions. Code, not database rows: a plan is a product decision
 * that ships with a release, and the firm stores only which one it chose.
 *
 * Prices are indicative and in integer cents, GST inclusive. Collection is
 * not wired — choosing a plan records the choice and nothing is charged
 * until Stripe checkout arrives.
 */

export type PlanCode = "TRIAL" | "CORE" | "GROWTH" | "SCALE";

export interface Plan {
  code: PlanCode;
  name: string;
  tagline: string;
  /** Per month when billed monthly. */
  monthlyCents: number;
  /** Per month when billed yearly. */
  yearlyMonthlyCents: number;
  /** Reconciled transactions per year (per month for the trial). */
  allowancePerYear: number;
  features: readonly string[];
  /** Named so the pricing page can mark what a plan lacks, not just what it has. */
  excludes: readonly string[];
  highlighted?: boolean;
}

const SHARED: readonly string[] = [
  "Unlimited client profiles",
  "AI reconciliation (bank feed, PDF, CSV)",
  "Coding Memory, per client and firm-wide",
  "Double-entry ledger with manual journals",
  "Custom chart of accounts",
  "Financial statements: P&L, Balance Sheet, Trial Balance, General Ledger",
  "Tax-ready reports: BAS, Transactions, TPAR, Depreciation, EOFY",
  "Every figure traceable to its journal line",
];

export const PLANS: readonly Plan[] = [
  {
    code: "TRIAL",
    name: "Trial",
    tagline: "Try the whole product on one firm.",
    monthlyCents: 0,
    yearlyMonthlyCents: 0,
    allowancePerYear: 1_000,
    features: [...SHARED, "Email support"],
    excludes: ["Unused transactions roll over", "Priority support", "Dedicated onboarding"],
  },
  {
    code: "CORE",
    name: "Core",
    tagline: "For firms with regular BAS work.",
    monthlyCents: 24_900,
    yearlyMonthlyCents: 19_900,
    allowancePerYear: 60_000,
    features: [...SHARED, "Unused transactions roll over", "Priority support"],
    excludes: ["Dedicated onboarding"],
  },
  {
    code: "GROWTH",
    name: "Growth",
    tagline: "For growing firms with several bookkeepers.",
    monthlyCents: 54_900,
    yearlyMonthlyCents: 44_900,
    allowancePerYear: 180_000,
    features: [...SHARED, "Unused transactions roll over", "Priority support", "Dedicated onboarding"],
    excludes: [],
    highlighted: true,
  },
  {
    code: "SCALE",
    name: "Scale",
    tagline: "For high-volume practices.",
    monthlyCents: 109_900,
    yearlyMonthlyCents: 89_900,
    allowancePerYear: 480_000,
    features: [...SHARED, "Unused transactions roll over", "Priority support", "Dedicated onboarding"],
    excludes: [],
  },
];

export function planByCode(code: string): Plan {
  return PLANS.find((plan) => plan.code === code) ?? PLANS[0]!;
}

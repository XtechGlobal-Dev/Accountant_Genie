/** The plan page: what the firm is on, what it has used, what it could choose. */

export interface PlanOption {
  code: string;
  name: string;
  tagline: string;
  monthlyCents: number;
  yearlyMonthlyCents: number;
  allowancePerYear: number;
  features: string[];
  excludes: string[];
  highlighted: boolean;
}

export interface BillingState {
  current: PlanOption;
  billingInterval: "MONTHLY" | "YEARLY";
  planChangedAt: Date | null;
  used: number;
  remaining: number;
  clientCount: number;
  plans: PlanOption[];
}

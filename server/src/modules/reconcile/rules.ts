import {
  CODE_BANK_FEES,
  CODE_INTEREST_CHARGED,
  CODE_INTEREST_INCOME,
  CODE_LOAN_PRINCIPAL,
  CODE_TRANSFER,
  CODE_WAGES,
} from "@/server/au/coa";
import type { GstTreatment } from "@/shared/enums";

/**
 * Deterministic rules — the transactions that must never reach the AI.
 *
 * These are unambiguous by construction: a bank fee is a bank fee whatever
 * the model thinks. Each rule names the account and the tax code, and says
 * whether a person still has to look (a loan repayment must be split, an ATO
 * payment might be GST or income tax).
 *
 * Pure, over the normalised description. The account codes are the system
 * chart's; the engine resolves them to the client's visible accounts and
 * falls through when one is missing or inactive.
 */

export interface RuleHit {
  rule: string;
  accountCode: number;
  gstTreatment: GstTreatment;
  /** True when the rule identifies the transaction but cannot finish coding it. */
  needsReview: boolean;
  reason: string;
}

const CODE_SUPER = 478;
const CODE_INCOME_TAX_PAYABLE = 830;

interface Rule {
  name: string;
  test: RegExp;
  accountCode: number;
  gstTreatment: GstTreatment;
  needsReview: boolean;
  reason: string;
}

export const RULES: readonly Rule[] = [
  {
    name: "transfer",
    test: /\b(transfer|tfr|internal transfer|to savings|from savings|linked acc)\b/,
    accountCode: CODE_TRANSFER,
    gstTreatment: "BAS_EXCLUDED",
    needsReview: false,
    reason: "Movement between the client's own accounts",
  },
  {
    name: "bank-fee",
    test: /\b(account (keeping|service) fee|monthly (account )?fee|bank fee|transaction fee|overdrawn fee|dishonour fee|international transaction fee)\b/,
    accountCode: CODE_BANK_FEES,
    gstTreatment: "INPUT_TAXED",
    needsReview: false,
    reason: "Bank fee — a financial supply, input taxed",
  },
  {
    name: "interest-charged",
    test: /\b(interest charged|debit interest|loan interest|overdraft interest|interest on (loan|overdraft))\b/,
    accountCode: CODE_INTEREST_CHARGED,
    gstTreatment: "INPUT_TAXED",
    needsReview: false,
    reason: "Interest charged — input taxed",
  },
  {
    name: "interest-received",
    test: /\b(interest (paid|received|earned|credit)|credit interest|deposit interest)\b/,
    accountCode: CODE_INTEREST_INCOME,
    gstTreatment: "INPUT_TAXED",
    needsReview: false,
    reason: "Interest received — input taxed",
  },
  {
    name: "wages",
    test: /\b(payroll|wages|salary|salaries|pay run)\b/,
    accountCode: CODE_WAGES,
    gstTreatment: "BAS_EXCLUDED",
    needsReview: false,
    reason: "Wages — reported at W1, never at 1B",
  },
  {
    name: "superannuation",
    test: /\b(superannuation|super guarantee|australiansuper|hostplus|rest super|sunsuper|cbus|hesta|clearing house|superstream)\b/,
    accountCode: CODE_SUPER,
    gstTreatment: "BAS_EXCLUDED",
    needsReview: false,
    reason: "Superannuation contribution — BAS excluded",
  },
  {
    name: "ato",
    test: /\b(ato|australian taxation office|tax office)\b/,
    accountCode: CODE_INCOME_TAX_PAYABLE,
    gstTreatment: "BAS_EXCLUDED",
    needsReview: true,
    reason: "ATO payment — confirm whether it settles a BAS or income tax",
  },
  {
    name: "loan-repayment",
    test: /\b(loan repayment|loan payment|repayment to loan|equipment finance|chattel mortgage)\b/,
    accountCode: CODE_LOAN_PRINCIPAL,
    gstTreatment: "BAS_EXCLUDED",
    needsReview: true,
    reason: "Loan repayment — split principal from interest before accepting",
  },
];

/** The first rule that matches, or null to let the next tier decide. */
export function applyRules(normalised: string): RuleHit | null {
  for (const rule of RULES) {
    if (rule.test.test(normalised)) {
      return {
        rule: rule.name,
        accountCode: rule.accountCode,
        gstTreatment: rule.gstTreatment,
        needsReview: rule.needsReview,
        reason: rule.reason,
      };
    }
  }
  return null;
}

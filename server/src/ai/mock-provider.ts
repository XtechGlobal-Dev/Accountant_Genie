import {
  sanitiseResult,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
} from "./types";

/**
 * Deterministic, offline, free.
 *
 * This exists so the whole reconciliation pipeline, the review UI and the test
 * suite can run with no API key and no cost. It is not a toy — CI depends on it,
 * and it makes AI-layer regressions reproducible.
 *
 * It abstains on anything it does not recognise, which is exactly the behaviour
 * the real provider is held to.
 */
const KEYWORDS: Array<[RegExp, number, string]> = [
  [/\b(woolworths|coles|aldi|iga)\b/i, 482, "GST_ON_EXPENSES"],
  [/\b(bunnings|mitre ?10|officeworks)\b/i, 473, "GST_ON_EXPENSES"],
  [/\b(bp|caltex|shell|ampol|7-eleven|united petroleum)\b/i, 449, "GST_ON_EXPENSES"],
  [/\b(telstra|optus|vodafone|tpg|aussie broadband)\b/i, 457, "GST_ON_EXPENSES"],
  [/\b(aws|amazon web|microsoft|google|adobe|atlassian|xero|canva)\b/i, 433, "GST_ON_EXPENSES"],
  [/\b(agl|origin energy|energy australia)\b/i, 453, "GST_ON_EXPENSES"],
  [/account (keeping )?fee|monthly fee|bank fee/i, 404, "INPUT_TAXED"],
  [/interest charged|loan interest/i, 400, "INPUT_TAXED"],
  [/interest (paid|earned)|credit interest/i, 202, "INPUT_TAXED"],
  [/\b(ato|australian taxation)\b/i, 830, "BAS_EXCLUDED"],
  [/payroll|wages|salary/i, 477, "BAS_EXCLUDED"],
  [/\btransfer\b|internal tfr/i, 977, "BAS_EXCLUDED"],
  [/\bsuper\b|superannuation|australiansuper|hostplus|rest super/i, 478, "BAS_EXCLUDED"],
  [/\brent\b/i, 469, "GST_ON_EXPENSES"],
  [/insurance/i, 420, "GST_ON_EXPENSES"],
  [/council|rates/i, 465, "GST_FREE_EXPENSES"],
  [/invoice|payment received|deposit/i, 200, "GST_ON_INCOME"],
];

export class MockProvider implements AccountingAIProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic-v1";

  async classifyTransactions(input: ClassificationInput): Promise<ClassificationResponse> {
    const valid = new Set(input.accounts.map((a) => a.code));

    const results = input.transactions.map((t) => {
      const hit = KEYWORDS.find(([re]) => re.test(t.description));

      if (!hit || !valid.has(hit[1])) {
        return sanitiseResult({
          ref: t.ref,
          accountCode: 0,
          gstTreatment: "UNALLOCATED",
          confidence: 0,
          reason: "No deterministic match — abstaining",
          needsReview: true,
        });
      }

      const [, code, treatment] = hit;
      return sanitiseResult({
        ref: t.ref,
        accountCode: code,
        gstTreatment: treatment as never,
        confidence: 0.9,
        reason: `Matched mock keyword rule for account ${code}`,
        needsReview: false,
      });
    });

    return {
      results,
      meta: { provider: this.name, model: this.model, promptVersion: "mock-v1" },
    };
  }
}

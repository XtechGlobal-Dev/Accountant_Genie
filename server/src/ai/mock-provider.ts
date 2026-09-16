import {
  CODE_BANK_FEES,
  CODE_INCOME_TAX_PAYABLE,
  CODE_INTEREST_CHARGED,
  CODE_INTEREST_INCOME,
  CODE_SUPERANNUATION,
  CODE_TRANSFER,
  CODE_WAGES,
} from "@/server/au/coa";
import { buildContext, buildSubcontractorContext, hashInput } from "./prompt";
import {
  sanitiseResult,
  sanitiseSubcontractor,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
  type SubcontractorInput,
  type SubcontractorResponse,
} from "./types";

/**
 * Deterministic, offline, free.
 *
 * This exists so the whole reconciliation pipeline, the review UI and the test
 * suite can run with no API key and no cost. It is not a toy — CI depends on it,
 * and it makes AI-layer regressions reproducible.
 *
 * It abstains on anything it does not recognise, which is exactly the behaviour
 * the real provider is held to. Its prompt versions name no file on disk on
 * purpose: they are stamped on lineage so a mock-coded row can never be
 * mistaken for one a real model produced.
 *
 * Account codes come from the chart's named constants where one exists, and
 * from the chart supplied on 2026-09-16 otherwise. The mock never chooses a
 * tax treatment the chart's own default disagrees with: a treatment the
 * advisor has yet to confirm (bank fees, interest) is taken as the chart
 * gives it, like the rules tier does.
 */
const KEYWORDS: Array<[RegExp, number, string]> = [
  [/\b(woolworths|coles|aldi|iga)\b/i, 520, "GST_ON_EXPENSES"], // Amenities
  [/\b(bunnings|mitre ?10)\b/i, 327, "GST_ON_EXPENSES"], // Materials and supplies
  [/\bofficeworks\b/i, 450, "GST_ON_EXPENSES"], // Office Supplies
  [/\b(bp|caltex|shell|ampol|7-eleven|united petroleum)\b/i, 420, "GST_ON_EXPENSES"], // Motor Vehicle Fuel
  [/\b(telstra|optus|vodafone|tpg|aussie broadband)\b/i, 540, "GST_ON_EXPENSES"], // Telephone and Internet
  [/\b(aws|amazon web|microsoft|google|adobe|atlassian|xero|canva)\b/i, 470, "GST_ON_EXPENSES"], // Subscriptions
  [/\b(agl|origin energy|energy australia)\b/i, 360, "GST_ON_EXPENSES"], // Electricity, Gas and Water
  [/account (keeping )?fee|monthly fee|bank fee/i, CODE_BANK_FEES, "GST_FREE_EXPENSES"],
  [/interest charged|loan interest/i, CODE_INTEREST_CHARGED, "GST_FREE_EXPENSES"],
  [/interest (paid|earned)|credit interest/i, CODE_INTEREST_INCOME, "GST_FREE_INCOME"],
  [/\b(ato|australian taxation)\b/i, CODE_INCOME_TAX_PAYABLE, "BAS_EXCLUDED"],
  [/payroll|wages|salary/i, CODE_WAGES, "BAS_EXCLUDED"],
  [/\btransfer\b|internal tfr/i, CODE_TRANSFER, "BAS_EXCLUDED"],
  [/\bsuper\b|superannuation|australiansuper|hostplus|rest super/i, CODE_SUPERANNUATION, "BAS_EXCLUDED"],
  [/\brent\b/i, 480, "GST_ON_EXPENSES"], // Rent on Business Premises
  [/insurance/i, 330, "GST_ON_EXPENSES"], // Business Insurance Premiums
  [/council|rates/i, 365, "GST_FREE_EXPENSES"], // Rates & Land Taxes
  [/invoice|payment received|deposit|progress claim/i, 200, "GST_ON_INCOME"],
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
      meta: { provider: this.name, model: this.model, promptVersion: "mock-v1", inputHash: hashInput(buildContext(input)) },
    };
  }

  /** Matches a payment to a register entry whose name appears in the narration; otherwise abstains. */
  async identifySubcontractors(input: SubcontractorInput): Promise<SubcontractorResponse> {
    const results = input.transactions.map((t) => {
      const haystack = t.description.toLowerCase();
      const known = input.known.find((k) => k.name.length >= 4 && haystack.includes(k.name.toLowerCase()));
      return sanitiseSubcontractor(
        known
          ? { ref: t.ref, knownId: known.id, proposedName: null, confidence: 0.85, reason: `Narration names ${known.name}` }
          : { ref: t.ref, knownId: null, proposedName: null, confidence: 0, reason: "No register entry named in the narration — abstaining" },
      );
    });
    return {
      results,
      meta: { provider: this.name, model: this.model, promptVersion: "mock-subcontractor-v1", inputHash: hashInput(buildSubcontractorContext(input)) },
    };
  }
}

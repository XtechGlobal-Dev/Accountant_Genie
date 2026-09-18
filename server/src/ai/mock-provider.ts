import {
  CODE_BANK_FEES,
  CODE_INCOME_TAX_PAYABLE,
  CODE_INTEREST_CHARGED,
  CODE_INTEREST_INCOME,
  CODE_SUPERANNUATION,
  CODE_TRANSFER,
  CODE_WAGES,
} from "@/server/au/coa";
import { buildContext, buildReviewContext, buildSubcontractorContext, hashInput } from "./prompt";
import type { GstTreatment } from "@/generated/prisma";
import {
  sanitiseResult,
  sanitiseReview,
  sanitiseSubcontractor,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
  type ProposedAccount,
  type ReviewInput,
  type ReviewResponse,
  type ReviewResult,
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
interface Keyword {
  test: RegExp;
  code: number;
  treatment: GstTreatment;
  category: string;
  /** The mock, like the model, may know the account and still want a person to look. */
  review?: string;
}

const KEYWORDS: Keyword[] = [
  // Fuel before groceries: "SHELL COLES EXPRESS" is a servo, not a supermarket.
  { test: /\b(bp|caltex|shell|ampol|7-eleven|united petroleum)\b/i, code: 420, treatment: "GST_ON_EXPENSES", category: "Motor vehicle fuel" },
  { test: /\b(woolworths|coles|aldi|iga)\b/i, code: 520, treatment: "GST_ON_EXPENSES", category: "Amenities" },
  { test: /\b(bunnings|mitre ?10)\b/i, code: 327, treatment: "GST_ON_EXPENSES", category: "Materials and supplies" },
  { test: /\bofficeworks\b/i, code: 450, treatment: "GST_ON_EXPENSES", category: "Office supplies" },
  { test: /\b(telstra|optus|vodafone|tpg|aussie broadband)\b/i, code: 540, treatment: "GST_ON_EXPENSES", category: "Telephone and internet" },
  { test: /\b(aws|amazon web|microsoft|google|adobe|atlassian|xero|canva)\b/i, code: 470, treatment: "GST_ON_EXPENSES", category: "Software subscription" },
  { test: /\b(agl|origin energy|energy ?australia)\b/i, code: 360, treatment: "GST_ON_EXPENSES", category: "Electricity" },
  { test: /account (keeping )?fee|monthly fee|bank fee/i, code: CODE_BANK_FEES, treatment: "GST_FREE_EXPENSES", category: "Bank fee" },
  { test: /interest charged|loan interest/i, code: CODE_INTEREST_CHARGED, treatment: "GST_FREE_EXPENSES", category: "Interest charged" },
  { test: /interest (paid|earned)|credit interest/i, code: CODE_INTEREST_INCOME, treatment: "GST_FREE_INCOME", category: "Interest received" },
  {
    test: /\b(ato|australian taxation)\b/i,
    code: CODE_INCOME_TAX_PAYABLE,
    treatment: "BAS_EXCLUDED",
    category: "ATO payment",
    // The same reservation the rules tier makes: a BAS or income tax, a person decides.
    review: "ATO payment — confirm whether it settles a BAS or income tax",
  },
  { test: /payroll|wages|salary/i, code: CODE_WAGES, treatment: "BAS_EXCLUDED", category: "Wages" },
  { test: /\btransfer\b|internal tfr/i, code: CODE_TRANSFER, treatment: "BAS_EXCLUDED", category: "Transfer" },
  { test: /\bsuper\b|superannuation|australiansuper|hostplus|rest super/i, code: CODE_SUPERANNUATION, treatment: "BAS_EXCLUDED", category: "Superannuation" },
  {
    test: /\brent\b/i,
    code: 480,
    treatment: "GST_ON_EXPENSES",
    category: "Rent",
    // Commercial rent carries GST only when the landlord is registered, and a
    // bank line cannot say. The account is clear; the treatment is a person's call.
    review: "Rent — confirm whether the landlord charges GST before accepting",
  },
  { test: /insurance/i, code: 330, treatment: "GST_ON_EXPENSES", category: "Insurance" },
  { test: /council|rates/i, code: 365, treatment: "GST_FREE_EXPENSES", category: "Rates" },
  { test: /invoice|payment received|deposit|progress claim/i, code: 200, treatment: "GST_ON_INCOME", category: "Sales" },
];

/**
 * A narration the chart has no account for. The mock proposes one the way
 * the model is asked to — by the nature of the supply, never the vendor — so
 * the account-creation path is exercised offline.
 */
const PROPOSALS: Array<{ test: RegExp; category: string; proposal: ProposedAccount }> = [
  {
    test: /\b(charity|donation)\b/i,
    category: "Donation",
    proposal: { name: "Donations", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED" },
  },
];

/** The first two words of the narration, title-cased — the mock's idea of a vendor. */
function vendorOf(description: string): string | null {
  const words = description.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).filter((w) => !/^\d+$/.test(w)).slice(0, 2);
  if (words.length === 0) return null;
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export class MockProvider implements AccountingAIProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic-v2";

  async classifyTransactions(input: ClassificationInput): Promise<ClassificationResponse> {
    const valid = new Set(input.accounts.map((a) => a.code));

    const results = input.transactions.map((t) => {
      const vendor = vendorOf(t.description);
      const hit = KEYWORDS.find((k) => k.test.test(t.description));

      if (hit && valid.has(hit.code)) {
        return sanitiseResult({
          ref: t.ref,
          accountCode: hit.code,
          gstTreatment: hit.treatment,
          confidence: 0.96,
          reason: hit.review ?? `Matched mock keyword rule for account ${hit.code}`,
          needsReview: hit.review !== undefined,
          vendor,
          category: hit.category,
          proposedAccount: null,
        });
      }

      const proposal = PROPOSALS.find((p) => p.test.test(t.description));
      if (proposal) {
        return sanitiseResult({
          ref: t.ref,
          accountCode: 0,
          gstTreatment: "UNALLOCATED",
          confidence: 0.96,
          reason: `No account in the chart for ${proposal.category.toLowerCase()} — proposing one`,
          needsReview: false,
          vendor,
          category: proposal.category,
          proposedAccount: proposal.proposal,
        });
      }

      return sanitiseResult({
        ref: t.ref,
        accountCode: 0,
        gstTreatment: "UNALLOCATED",
        confidence: 0,
        reason: "No deterministic match — abstaining",
        needsReview: true,
        vendor,
        category: null,
        proposedAccount: null,
      });
    });

    return {
      results,
      meta: { provider: this.name, model: this.model, promptVersion: "mock-v1", inputHash: hashInput(buildContext(input)) },
    };
  }

  /**
   * The second opinion, from the same keyword table the classifier used, so
   * the offline pipeline exercises every verdict deterministically:
   *
   *   - the keyword names the proposed account → AGREE at 0.97, unless the
   *     keyword itself asks for a person (rent, an ATO payment) → ESCALATE
   *   - the keyword names a different account → DISAGREE, suggesting it
   *   - a proposed new account the mock would itself propose → AGREE
   *   - nothing recognised → ESCALATE at 0: no basis to confirm the coding
   */
  async reviewClassifications(input: ReviewInput): Promise<ReviewResponse> {
    const valid = new Set(input.accounts.map((a) => a.code));
    const results: ReviewResult[] = input.transactions.map((t) => {
      const base = { ref: t.ref, suggestedAccountCode: null, suggestedGstTreatment: null };
      if (t.proposedAccount) {
        const proposal = PROPOSALS.find((p) => p.test.test(t.description));
        return sanitiseReview(
          proposal && proposal.proposal.name === t.proposedAccount.name
            ? { ...base, verdict: "AGREE", confidence: 0.97, reason: `The chart has no account for ${proposal.category.toLowerCase()}; the proposed account names the nature of the supply` }
            : { ...base, verdict: "ESCALATE", confidence: 0, reason: "No deterministic basis to confirm the proposed account" },
        );
      }
      const hit = KEYWORDS.find((k) => k.test.test(t.description));
      if (!hit) {
        return sanitiseReview({ ...base, verdict: "ESCALATE", confidence: 0, reason: "No deterministic basis to confirm this coding" });
      }
      if (hit.code !== t.proposal.accountCode) {
        return sanitiseReview({
          ...base,
          verdict: "DISAGREE",
          confidence: 0.9,
          reason: `Mock keyword rule codes this to ${hit.code}`,
          suggestedAccountCode: valid.has(hit.code) ? hit.code : null,
          suggestedGstTreatment: valid.has(hit.code) ? hit.treatment : null,
        });
      }
      if (hit.review) {
        return sanitiseReview({ ...base, verdict: "ESCALATE", confidence: 0.5, reason: hit.review });
      }
      return sanitiseReview({ ...base, verdict: "AGREE", confidence: 0.97, reason: `Mock keyword rule agrees with account ${hit.code}` });
    });
    return {
      results,
      meta: { provider: this.name, model: this.model, promptVersion: "mock-review-v1", inputHash: hashInput(buildReviewContext(input)) },
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

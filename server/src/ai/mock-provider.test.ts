import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock-provider";
import type { ReviewInput, ReviewInputTx } from "./types";

/**
 * The mock reviewer is what CI runs the pipeline against, so each verdict it
 * can give is pinned here: the offline pipeline test relies on Adobe agreeing,
 * rent escalating and a donation's proposed account being confirmed.
 */

const accounts = [
  { code: 450, name: "Office Supplies", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" as const },
  { code: 470, name: "Subscriptions", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" as const },
  { code: 480, name: "Rent on Business Premises", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" as const },
];

function tx(ref: string, description: string, code: number, over: Partial<ReviewInputTx> = {}): ReviewInputTx {
  const account = accounts.find((a) => a.code === code);
  return {
    ref,
    description,
    amountCents: -10000,
    date: "2026-09-01",
    proposal: { accountCode: code, accountName: account?.name ?? "Proposed", gstTreatment: "GST_ON_EXPENSES", confidence: 0.96, reason: "r", vendor: null, category: null },
    proposedAccount: null,
    classifierConcern: null,
    firstSeen: true,
    ...over,
  };
}

async function review(transactions: ReviewInputTx[]) {
  const input: ReviewInput = { transactions, client: { industry: null, entityType: "COMPANY", gstRegistered: true }, accounts, memory: [], history: [] };
  return (await new MockProvider().reviewClassifications(input)).results;
}

describe("MockProvider.reviewClassifications", () => {
  it("agrees when its keyword names the proposed account, disagrees with a suggestion when it names another", async () => {
    const [agree, disagree] = await review([tx("a", "ADOBE CREATIVE CLOUD", 470), tx("b", "OFFICEWORKS AUBURN", 470)]);
    expect(agree).toMatchObject({ ref: "a", verdict: "AGREE", confidence: 0.97, suggestedAccountCode: null });
    expect(disagree).toMatchObject({ ref: "b", verdict: "DISAGREE", suggestedAccountCode: 450, suggestedGstTreatment: "GST_ON_EXPENSES" });
  });

  it("escalates what its keyword table reserves for a person, and what it does not recognise", async () => {
    const [rent, unknown] = await review([tx("r", "MONTHLY OFFICE RENT", 480), tx("u", "XYZ PTY LTD", 470)]);
    expect(rent).toMatchObject({ verdict: "ESCALATE", reason: "Rent — confirm whether the landlord charges GST before accepting" });
    expect(unknown).toMatchObject({ verdict: "ESCALATE", confidence: 0 });
  });

  it("confirms a proposed account it would itself have proposed, and escalates any other", async () => {
    const donations = { name: "Donations", type: "EXPENSE" as const, gstTreatment: "BAS_EXCLUDED" as const };
    const [ok, other] = await review([
      tx("d", "CHARITY DONATION RED CROSS", 0, { proposedAccount: donations }),
      tx("o", "CHARITY DONATION RED CROSS", 0, { proposedAccount: { ...donations, name: "Red Cross" } }),
    ]);
    expect(ok).toMatchObject({ verdict: "AGREE", confidence: 0.97 });
    expect(other).toMatchObject({ verdict: "ESCALATE" });
  });
});

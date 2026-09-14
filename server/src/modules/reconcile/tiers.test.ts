import { describe, expect, it } from "vitest";
import { matchMemory } from "./memory";
import { scoreRisk } from "./risk";
import { applyRules } from "./rules";

describe("applyRules", () => {
  it("codes the unambiguous cases without review", () => {
    expect(applyRules("account keeping fee")).toMatchObject({ accountCode: 404, gstTreatment: "INPUT_TAXED", needsReview: false });
    expect(applyRules("interest charged")).toMatchObject({ accountCode: 400, gstTreatment: "INPUT_TAXED" });
    expect(applyRules("credit interest")).toMatchObject({ accountCode: 202, gstTreatment: "INPUT_TAXED" });
    expect(applyRules("payroll run 12")).toMatchObject({ accountCode: 477, gstTreatment: "BAS_EXCLUDED" });
    expect(applyRules("transfer to savings")).toMatchObject({ accountCode: 977, gstTreatment: "BAS_EXCLUDED" });
    expect(applyRules("australiansuper contribution")).toMatchObject({ accountCode: 478 });
  });

  it("identifies but does not finish the ambiguous cases", () => {
    expect(applyRules("ato payment")).toMatchObject({ needsReview: true });
    expect(applyRules("loan repayment")).toMatchObject({ accountCode: 840, needsReview: true });
  });

  it("leaves everything else to the next tier", () => {
    expect(applyRules("bunnings alexandria")).toBeNull();
    expect(applyRules("")).toBeNull();
  });
});

describe("matchMemory", () => {
  const firmRule = { id: "f", clientId: null, matchType: "CONTAINS" as const, pattern: "bunnings", accountId: "a1", gstTreatment: "GST_ON_EXPENSES" as const, evidenceCount: 1 };
  const clientRule = { id: "c", clientId: "client", matchType: "CONTAINS" as const, pattern: "bunnings", accountId: "a2", gstTreatment: "GST_ON_CAPITAL" as const, evidenceCount: 1 };
  const exact = { id: "e", clientId: null, matchType: "EXACT" as const, pattern: "bunnings alexandria", accountId: "a3", gstTreatment: "GST_ON_EXPENSES" as const, evidenceCount: 1 };

  it("prefers the client's rule over the firm's", () => {
    expect(matchMemory([firmRule, clientRule], "bunnings alexandria")?.id).toBe("c");
  });

  it("prefers exact over contains, and longer over shorter, within a scope", () => {
    expect(matchMemory([firmRule, exact], "bunnings alexandria")?.id).toBe("e");
    const short = { ...firmRule, id: "s", pattern: "bun" };
    expect(matchMemory([short, firmRule], "bunnings alexandria")?.id).toBe("f");
  });

  it("returns null when nothing matches", () => {
    expect(matchMemory([firmRule, exact], "coles")).toBeNull();
    expect(matchMemory([], "anything")).toBeNull();
  });
});

describe("scoreRisk", () => {
  const config = { highRiskCents: 500_000 };

  it("is low for a small, familiar operating expense", () => {
    expect(scoreRisk({ amountCents: -8850, novel: false, gstTreatment: "GST_ON_EXPENSES", accountType: "EXPENSE" }, config)).toBe("LOW");
  });

  it("is high for large amounts, capital, balance-sheet postings and big novel merchants", () => {
    expect(scoreRisk({ amountCents: -600_000, novel: false, gstTreatment: "GST_ON_EXPENSES", accountType: "EXPENSE" }, config)).toBe("HIGH");
    expect(scoreRisk({ amountCents: -20_000, novel: false, gstTreatment: "GST_ON_CAPITAL", accountType: "ASSET" }, config)).toBe("HIGH");
    expect(scoreRisk({ amountCents: -20_000, novel: false, gstTreatment: "BAS_EXCLUDED", accountType: "LIABILITY" }, config)).toBe("HIGH");
    expect(scoreRisk({ amountCents: -60_000, novel: true, gstTreatment: "GST_ON_EXPENSES", accountType: "EXPENSE" }, config)).toBe("HIGH");
  });

  it("tolerates a small novel merchant", () => {
    expect(scoreRisk({ amountCents: -2_000, novel: true, gstTreatment: "GST_ON_EXPENSES", accountType: "EXPENSE" }, config)).toBe("LOW");
  });
});

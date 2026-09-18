import { describe, expect, it } from "vitest";
import { AU_CHART_OF_ACCOUNTS } from "@/server/au/coa";
import { accountSimilarity, findSimilarAccount, nameTokens, nextCustomCode, type ResolvableAccount } from "./resolver";

/**
 * The resolver is what stands between "the model proposed an account" and a
 * chart with one account per vendor. These pin the two decisions it makes.
 */

const chart: ResolvableAccount[] = AU_CHART_OF_ACCOUNTS.filter((a) => a.type !== "UNKNOWN").map((a) => ({
  id: `sys-${a.code}`,
  code: a.code,
  name: a.name,
  type: a.type,
  gstTreatment: a.gstTreatment,
  description: a.description ?? null,
}));

const byCode = (code: number) => chart.find((a) => a.code === code)!;

describe("nameTokens", () => {
  it("drops filler and stems plurals so near-names compare equal", () => {
    expect(nameTokens("Software Subscriptions")).toEqual(new Set(["software", "subscription"]));
    expect(nameTokens("Office Supplies Expense")).toEqual(new Set(["office", "supply"]));
    expect(nameTokens("Electricity, Gas and Water")).toEqual(new Set(["electricity", "gas", "water"]));
  });
});

describe("findSimilarAccount — existing account match", () => {
  it("reuses 470 Subscriptions for a proposed Software Subscriptions account", () => {
    const hit = findSimilarAccount(chart, { name: "Software Subscriptions", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).toBe(470);
  });

  it("reuses 450 Office Supplies for Stationery and Office Supplies", () => {
    const hit = findSimilarAccount(chart, { name: "Stationery and Office Supplies", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).toBe(450);
  });

  it("reuses 360 Electricity, Gas and Water for Utilities, via the description and synonyms", () => {
    const hit = findSimilarAccount(chart, { name: "Utilities", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).toBe(360);
  });

  it("reuses 480 Rent on Business Premises for Rent Expense", () => {
    const hit = findSimilarAccount(chart, { name: "Rent Expense", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).toBe(480);
  });

  it("reuses 600 Wages & Salaries for Wages and Salaries", () => {
    const hit = findSimilarAccount(chart, { name: "Wages and Salaries", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED" });
    expect(hit?.account.code).toBe(600);
  });

  it("never matches across types: an income account cannot stand in for an expense proposal", () => {
    // 204 Rent Received is INCOME; the proposal is an EXPENSE.
    const hit = findSimilarAccount(chart, { name: "Rent Received", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).not.toBe(204);
  });

  it("finds nothing for a supply the chart genuinely lacks", () => {
    expect(findSimilarAccount(chart, { name: "Donations", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED" })).toBeNull();
    expect(findSimilarAccount(chart, { name: "Franchise Royalties", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" })).toBeNull();
  });

  it("does not treat a vendor-named proposal as a new kind of account", () => {
    // "Adobe Subscriptions" still means subscriptions; the vendor word is noise the
    // chart account does not carry, and containment of the chart's name wins.
    const hit = findSimilarAccount(chart, { name: "Adobe Subscriptions", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" });
    expect(hit?.account.code).toBe(470);
  });

  it("scores an unrelated account below the threshold", () => {
    expect(accountSimilarity(byCode(410), { name: "Software Subscriptions", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" })).toBeLessThan(0.5);
  });
});

describe("nextCustomCode — duplicate account prevention by code", () => {
  const taken = chart.map((a) => a.code);

  it("starts each type's band above the system chart", () => {
    expect(nextCustomCode(taken, "EXPENSE")).toBe(1400);
    expect(nextCustomCode(taken, "INCOME")).toBe(1200);
    expect(nextCustomCode(taken, "LIABILITY")).toBe(1800);
  });

  it("skips codes the firm already uses and steps by ten", () => {
    expect(nextCustomCode([...taken, 1400], "EXPENSE")).toBe(1410);
    expect(nextCustomCode([...taken, 1400, 1410, 1415], "EXPENSE")).toBe(1420);
  });

  it("fills gaps once the multiples of ten are used, and is null when the band is full", () => {
    const tens = Array.from({ length: 10 }, (_, i) => 1200 + i * 10);
    expect(nextCustomCode([...taken, ...tens], "INCOME")).toBe(1201);
    const all = Array.from({ length: 100 }, (_, i) => 1200 + i);
    expect(nextCustomCode([...taken, ...all], "INCOME")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  basLabelsFor,
  gstFromGross,
  isUnresolved,
  naturalGross,
  netFromGross,
  splitGst,
} from "./gst";

describe("gstFromGross", () => {
  it("is gross / 11 for GST-bearing treatments", () => {
    expect(gstFromGross(11000, "GST_ON_INCOME")).toBe(1000);
    expect(gstFromGross(330000, "GST_ON_EXPENSES")).toBe(30000);
    expect(gstFromGross(2200000, "GST_ON_CAPITAL")).toBe(200000);
  });

  it("is zero for everything else — bank fees and wages carry no GST", () => {
    expect(gstFromGross(11000, "INPUT_TAXED")).toBe(0);
    expect(gstFromGross(11000, "BAS_EXCLUDED")).toBe(0);
    expect(gstFromGross(11000, "GST_FREE_INCOME")).toBe(0);
    expect(gstFromGross(11000, "GST_FREE_EXPENSES")).toBe(0);
    expect(gstFromGross(11000, "UNALLOCATED")).toBe(0);
  });

  it("splits gross into net and GST that sum back exactly", () => {
    const split = splitGst(12345, "GST_ON_EXPENSES");
    expect(split.gstCents + split.netCents).toBe(12345);
    expect(netFromGross(12345, "GST_ON_EXPENSES")).toBe(split.netCents);
  });
});

describe("naturalGross", () => {
  it("is credit-natural for income codes", () => {
    expect(naturalGross("GST_ON_INCOME", 0, 11000)).toBe(11000);
    // A refund of a sale is a debit to income: negative income.
    expect(naturalGross("GST_ON_INCOME", 11000, 0)).toBe(-11000);
    expect(naturalGross("GST_FREE_INCOME", 0, 500)).toBe(500);
  });

  it("is debit-natural for expense, capital and excluded codes", () => {
    expect(naturalGross("GST_ON_EXPENSES", 3300, 0)).toBe(3300);
    expect(naturalGross("GST_ON_EXPENSES", 0, 3300)).toBe(-3300);
    expect(naturalGross("GST_ON_CAPITAL", 5000, 0)).toBe(5000);
    expect(naturalGross("BAS_EXCLUDED", 700, 0)).toBe(700);
    expect(naturalGross("INPUT_TAXED", 15, 0)).toBe(15);
  });
});

describe("BAS label mapping", () => {
  it("routes sales to G1 and 1A, purchases to G11 and 1B, capital to G10 and 1B", () => {
    expect(basLabelsFor("GST_ON_INCOME")).toEqual(["G1", "1A"]);
    expect(basLabelsFor("GST_FREE_INCOME")).toEqual(["G1"]);
    expect(basLabelsFor("GST_ON_EXPENSES")).toEqual(["G11", "1B"]);
    expect(basLabelsFor("GST_ON_CAPITAL")).toEqual(["G10", "1B"]);
  });

  it("keeps excluded and input-taxed treatments off the Simple BAS", () => {
    expect(basLabelsFor("BAS_EXCLUDED")).toEqual([]);
    expect(basLabelsFor("INPUT_TAXED")).toEqual([]);
  });

  it("treats only UNALLOCATED as unresolved", () => {
    expect(isUnresolved("UNALLOCATED")).toBe(true);
    expect(isUnresolved("BAS_EXCLUDED")).toBe(false);
  });
});

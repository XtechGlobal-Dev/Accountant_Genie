import { describe, expect, it } from "vitest";
import { centsToInput, formatBasisPoints, parseBasisPoints, parseCents } from "./money";

describe("parseBasisPoints", () => {
  it("turns a percentage into basis points exactly", () => {
    expect(parseBasisPoints("33.33")).toBe(3333);
    expect(parseBasisPoints("50")).toBe(5000);
    expect(parseBasisPoints("12.5%")).toBe(1250);
    expect(parseBasisPoints("100")).toBe(10000);
  });

  it("refuses negatives, a third decimal and non-numbers", () => {
    expect(parseBasisPoints("-5")).toBeNull();
    expect(parseBasisPoints("33.333")).toBeNull();
    expect(parseBasisPoints("half")).toBeNull();
  });

  it("formats back with two decimals", () => {
    expect(formatBasisPoints(3333)).toBe("33.33%");
    expect(formatBasisPoints(10000)).toBe("100.00%");
  });
});

describe("parseCents", () => {
  it("parses plain dollars and cents exactly", () => {
    expect(parseCents("1234.50")).toBe(123450);
    expect(parseCents("0.29")).toBe(29);
    expect(parseCents("12")).toBe(1200);
    expect(parseCents(".5")).toBe(50);
    expect(parseCents("7.")).toBe(700);
  });

  it("accepts currency symbols, thousands separators and whitespace", () => {
    expect(parseCents(" $1,234.5 ")).toBe(123450);
  });

  it("reads negatives in both accounting notations", () => {
    expect(parseCents("-3.10")).toBe(-310);
    expect(parseCents("(3.10)")).toBe(-310);
  });

  it("refuses more than two decimals rather than rounding", () => {
    expect(parseCents("1.005")).toBeNull();
  });

  it("refuses anything that is not an amount", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("1.2.3")).toBeNull();
    expect(parseCents("-")).toBeNull();
  });
});

describe("centsToInput", () => {
  it("round-trips through parseCents", () => {
    for (const cents of [0, 1, 99, 100, 123456, -310]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });

  it("always shows two decimals", () => {
    expect(centsToInput(5)).toBe("0.05");
    expect(centsToInput(120000)).toBe("1200.00");
  });
});

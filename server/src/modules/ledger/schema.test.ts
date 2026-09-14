import { describe, expect, it } from "vitest";
import { CalendarDateSchema, JournalInputSchema } from "./schema";

const valid = {
  date: "2025-08-15",
  reference: "INV-1",
  description: "August sales",
  source: "MANUAL",
  lines: [
    { accountId: "cash", debitCents: 11000, creditCents: 0 },
    { accountId: "sales", debitCents: 0, creditCents: 11000 },
  ],
};

describe("JournalInputSchema", () => {
  it("parses a valid journal and turns the date into UTC midnight", () => {
    const result = JournalInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date.toISOString()).toBe("2025-08-15T00:00:00.000Z");
      expect(result.data.lines).toHaveLength(2);
    }
  });

  it("rejects an unbalanced journal with the problem on the lines", () => {
    const result = JournalInputSchema.safeParse({
      ...valid,
      lines: [
        { accountId: "cash", debitCents: 11000, creditCents: 0 },
        { accountId: "sales", debitCents: 0, creditCents: 10000 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["lines"]);
      expect(result.error.issues[0]?.message).toMatch(/Debits must equal credits/);
    }
  });

  it("rejects dollars or fractional cents — only integer cents cross the boundary", () => {
    const result = JournalInputSchema.safeParse({
      ...valid,
      lines: [
        { accountId: "cash", debitCents: 110.5, creditCents: 0 },
        { accountId: "sales", debitCents: 0, creditCents: 110.5 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amounts", () => {
    const result = JournalInputSchema.safeParse({
      ...valid,
      lines: [
        { accountId: "cash", debitCents: -100, creditCents: 0 },
        { accountId: "sales", debitCents: 0, creditCents: -100 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(JournalInputSchema.safeParse({ ...valid, source: "BANK" }).success).toBe(false);
  });

  it("rejects garbage payloads outright", () => {
    expect(JournalInputSchema.safeParse(null).success).toBe(false);
    expect(JournalInputSchema.safeParse("journal").success).toBe(false);
    expect(JournalInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("CalendarDateSchema", () => {
  it("rejects impossible dates instead of rolling them over", () => {
    expect(CalendarDateSchema.safeParse("2025-02-30").success).toBe(false);
    expect(CalendarDateSchema.safeParse("2025-13-01").success).toBe(false);
    expect(CalendarDateSchema.safeParse("15/08/2025").success).toBe(false);
  });

  it("accepts a leap day", () => {
    expect(CalendarDateSchema.safeParse("2024-02-29").success).toBe(true);
  });
});

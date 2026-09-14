import { describe, expect, it } from "vitest";
import { periodQuery, resolvePeriod } from "./period";

// 8 September 2026 → FY2027, Q1.
const NOW = new Date(Date.UTC(2026, 8, 8));

describe("resolvePeriod", () => {
  it("defaults to the current quarter", () => {
    const period = resolvePeriod({}, NOW);
    expect(period.kind).toBe("quarter");
    expect(period.fy).toBe(2027);
    expect(period.quarter).toBe(1);
    expect(period.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("resolves a whole financial year", () => {
    const period = resolvePeriod({ fy: "2026" }, NOW);
    expect(period.kind).toBe("fy");
    expect(period.start.toISOString()).toBe("2025-07-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(period.label).toBe("FY2026");
  });

  it("resolves a quarter and a month", () => {
    const q3 = resolvePeriod({ fy: "2026", q: "3" }, NOW);
    expect(q3.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(q3.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");

    const december = resolvePeriod({ fy: "2026", m: "5" }, NOW);
    expect(december.kind).toBe("month");
    expect(december.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(december.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to the current quarter for nonsense", () => {
    expect(resolvePeriod({ fy: "abc", q: "9" }, NOW).kind).toBe("quarter");
    expect(resolvePeriod({ fy: "1850" }, NOW).fy).toBe(2027);
  });

  it("round-trips through periodQuery", () => {
    const period = resolvePeriod({ fy: "2025", q: "2" }, NOW);
    expect(periodQuery(period)).toBe("?fy=2025&q=2");
    expect(resolvePeriod({ fy: "2025", q: "2" }, NOW)).toEqual(period);
  });
});

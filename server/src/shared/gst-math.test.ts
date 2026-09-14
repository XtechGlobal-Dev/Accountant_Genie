import { describe, expect, it } from "vitest";
import { gstComponentCents } from "./gst-math";

describe("gstComponentCents", () => {
  it("divides a GST-inclusive gross by eleven, not by ten", () => {
    expect(gstComponentCents(11000)).toBe(1000);
    // 110.00 × 0.10 would give 11.00 — the classic overstatement.
    expect(gstComponentCents(11000)).not.toBe(1100);
  });

  it("rounds half away from zero", () => {
    // 5 / 11 = 0.4545… → 0 ; 6 / 11 = 0.5454… → 1
    expect(gstComponentCents(5)).toBe(0);
    expect(gstComponentCents(6)).toBe(1);
    expect(gstComponentCents(-6)).toBe(-1);
  });

  it("preserves sign", () => {
    expect(gstComponentCents(-11000)).toBe(-1000);
    expect(gstComponentCents(0)).toBe(0);
  });
});

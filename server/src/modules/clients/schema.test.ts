import { describe, expect, it } from "vitest";
import { PartnersSchema } from "./schema";

describe("PartnersSchema", () => {
  it("accepts shares that sum to exactly 100%", () => {
    const result = PartnersSchema.safeParse({
      partners: [
        { name: "Kim", shareBasisPoints: 5000 },
        { name: "Lee", shareBasisPoints: 3333 },
        { name: "Sam", shareBasisPoints: 1667 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects shares that are out by a single basis point", () => {
    const result = PartnersSchema.safeParse({
      partners: [
        { name: "Kim", shareBasisPoints: 5000 },
        { name: "Lee", shareBasisPoints: 4999 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/exactly 100%/);
    }
  });

  it("rejects a zero share, an empty name and an empty list", () => {
    expect(
      PartnersSchema.safeParse({
        partners: [
          { name: "Kim", shareBasisPoints: 10000 },
          { name: "Lee", shareBasisPoints: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      PartnersSchema.safeParse({ partners: [{ name: "  ", shareBasisPoints: 10000 }] }).success,
    ).toBe(false);
    expect(PartnersSchema.safeParse({ partners: [] }).success).toBe(false);
  });

  it("rejects fractional basis points — the form must have rounded already", () => {
    expect(
      PartnersSchema.safeParse({ partners: [{ name: "Kim", shareBasisPoints: 10000.5 }] })
        .success,
    ).toBe(false);
  });
});

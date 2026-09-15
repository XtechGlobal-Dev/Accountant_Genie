import { describe, expect, it } from "vitest";
import { CreateClientSchema, PartnersSchema, TrustDetailsSchema } from "./schema";

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

describe("TrustDetailsSchema", () => {
  const trustee = { kind: "CORPORATE", name: "Horizon Holdings Pty Ltd", abn: "", signatories: ["Priya Sharma"] };

  it("accepts a corporate trustee with one beneficiary", () => {
    const result = TrustDetailsSchema.safeParse({ trustee, beneficiaries: [{ name: "Priya Sharma", kind: "INDIVIDUAL" }] });
    expect(result.success).toBe(true);
  });

  it("rejects a trust with no beneficiary — nothing could be distributed", () => {
    const result = TrustDetailsSchema.safeParse({ trustee, beneficiaries: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a nameless trustee and a nameless beneficiary", () => {
    expect(TrustDetailsSchema.safeParse({ trustee: { ...trustee, name: " " }, beneficiaries: [{ name: "B", kind: "INDIVIDUAL" }] }).success).toBe(false);
    expect(TrustDetailsSchema.safeParse({ trustee, beneficiaries: [{ name: "", kind: "COMPANY" }] }).success).toBe(false);
  });

  it("checks the trustee ABN with the same checksum as the client's", () => {
    expect(TrustDetailsSchema.safeParse({ trustee: { ...trustee, abn: "51 824 753 556" }, beneficiaries: [{ name: "B", kind: "TRUST" }] }).success).toBe(true);
    expect(TrustDetailsSchema.safeParse({ trustee: { ...trustee, abn: "51 824 753 557" }, beneficiaries: [{ name: "B", kind: "TRUST" }] }).success).toBe(false);
  });
});

describe("CreateClientSchema", () => {
  const base = { businessName: "Horizon Trade Services", gstRegistered: true, entityType: "COMPANY" };

  it("requires the client's ABN — blank is not accepted", () => {
    const result = CreateClientSchema.safeParse({ ...base, abn: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/ABN is required/);
  });

  it("accepts a valid ABN with spaces and rejects a checksum failure", () => {
    expect(CreateClientSchema.safeParse({ ...base, abn: "51 824 753 556" }).success).toBe(true);
    expect(CreateClientSchema.safeParse({ ...base, abn: "51 824 753 557" }).success).toBe(false);
  });
});

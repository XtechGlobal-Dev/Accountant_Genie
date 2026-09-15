import { describe, expect, it } from "vitest";
import { AssetSchema } from "./schema";

const base = {
  name: "Office computer",
  description: "",
  category: "COMPUTER_EQUIPMENT",
  totalCostCents: "",
  gstCents: "",
  costCents: "2,000.00",
  purchaseDate: "2026-07-01",
  method: "DIMINISHING_VALUE",
  effectiveLifeMonths: "4",
  privateUseBasisPoints: "",
  accountId: "",
  isCar: false,
};

describe("AssetSchema", () => {
  it("accepts the depreciable cost alone — total and GST are for the file", () => {
    const result = AssetSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.costCents).toBe(200_000);
      expect(result.data.totalCostCents).toBeNull();
      expect(result.data.effectiveLifeMonths).toBe(48);
    }
  });

  it("keeps the amount paid and its GST as integer cents", () => {
    const result = AssetSchema.safeParse({ ...base, totalCostCents: "2,200.00", gstCents: "200.00" });
    expect(result.success).toBe(true);
    if (result.success) expect([result.data.totalCostCents, result.data.gstCents]).toEqual([220_000, 20_000]);
  });

  it("refuses GST or an acquisition cost above the total, and an unknown category", () => {
    expect(AssetSchema.safeParse({ ...base, totalCostCents: "1,000.00", gstCents: "1,500.00" }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...base, totalCostCents: "1,000.00" }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...base, category: "BOATS" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { depreciationFor, depreciationSchedule, type DepreciableAsset } from "./depreciation";

const ute: DepreciableAsset = {
  id: "ute",
  name: "Ute",
  costCents: 4_000_000,
  purchaseDate: new Date("2025-07-01T00:00:00.000Z"),
  method: "PRIME_COST",
  effectiveLifeMonths: 96, // 8 years
  privateUseBasisPoints: 2_000, // 20% private
  disposedAt: null,
};

describe("depreciationFor", () => {
  it("prime cost: a full year is cost ÷ effective life, reduced for private use", () => {
    const line = depreciationFor(ute, 2026)!;
    expect(line.depreciationCents).toBe(500_000);
    expect(line.deductibleCents).toBe(400_000);
    expect(line.closingCents).toBe(3_500_000);
    expect(line.daysHeld).toBe(365);
  });

  it("prime cost: later years start from the written-down value but decline by the same amount", () => {
    const line = depreciationFor(ute, 2028)!;
    expect(line.openingCents).toBe(3_000_000);
    expect(line.depreciationCents).toBe(500_000);
  });

  it("pro-rates a mid-year purchase by days held", () => {
    const laptop: DepreciableAsset = {
      ...ute,
      id: "laptop",
      name: "Laptop",
      costCents: 200_000,
      purchaseDate: new Date("2026-01-01T00:00:00.000Z"),
      effectiveLifeMonths: 48,
      privateUseBasisPoints: 0,
    };
    const line = depreciationFor(laptop, 2026)!;
    // 181 days of a 365-day year at 25% p.a. of 2,000.00
    expect(line.daysHeld).toBe(181);
    expect(line.depreciationCents).toBe(Math.round(200_000 * (181 / 365) * 0.25));
  });

  it("diminishing value: 200% ÷ life on the opening value each year", () => {
    const dv: DepreciableAsset = { ...ute, method: "DIMINISHING_VALUE", privateUseBasisPoints: 0 };
    const y1 = depreciationFor(dv, 2026)!;
    expect(y1.depreciationCents).toBe(1_000_000);
    const y2 = depreciationFor(dv, 2027)!;
    expect(y2.openingCents).toBe(3_000_000);
    expect(y2.depreciationCents).toBe(750_000);
  });

  it("never declines below zero and stops after disposal", () => {
    const short: DepreciableAsset = { ...ute, effectiveLifeMonths: 12, privateUseBasisPoints: 0 };
    expect(depreciationFor(short, 2026)!.closingCents).toBe(0);
    expect(depreciationFor(short, 2027)!.depreciationCents).toBe(0);

    const sold = { ...ute, disposedAt: new Date("2026-03-31T00:00:00.000Z") };
    expect(depreciationFor(sold, 2027)).toBeNull();
    expect(depreciationFor(sold, 2026)!.daysHeld).toBe(273);
  });

  it("is absent before the asset was bought", () => {
    expect(depreciationFor(ute, 2025)).toBeNull();
  });
});

describe("verified thresholds", () => {
  it("writes an asset off in full in its purchase year only when a verified threshold covers it", () => {
    const laptop: DepreciableAsset = { ...ute, id: "l", name: "Laptop", costCents: 150_000, privateUseBasisPoints: 0, effectiveLifeMonths: 48 };
    expect(depreciationFor(laptop, 2026, { instantWriteOffCents: 200_000 })!.depreciationCents).toBe(150_000);
    expect(depreciationFor(laptop, 2026, { instantWriteOffCents: 100_000 })!.depreciationCents).toBe(37_500);
    expect(depreciationFor(laptop, 2026, {})!.depreciationCents).toBe(37_500);
    expect(depreciationFor(laptop, 2027, { instantWriteOffCents: 200_000 })!.depreciationCents).toBe(0);
  });

  it("caps a car at the verified limit and ignores the limit for other assets", () => {
    const car: DepreciableAsset = { ...ute, isCar: true, privateUseBasisPoints: 0 };
    const line = depreciationFor(car, 2026, { carLimitCents: 3_200_000 })!;
    expect(line.costCents).toBe(3_200_000);
    expect(line.depreciationCents).toBe(400_000);
    expect(depreciationFor({ ...car, isCar: false }, 2026, { carLimitCents: 3_200_000 })!.costCents).toBe(4_000_000);
  });
});

describe("depreciationSchedule", () => {
  it("totals the year's lines", () => {
    const schedule = depreciationSchedule([ute, { ...ute, id: "ute2", name: "Ute 2", privateUseBasisPoints: 0 }], 2026);
    expect(schedule.lines).toHaveLength(2);
    expect(schedule.totalDepreciationCents).toBe(1_000_000);
    expect(schedule.totalDeductibleCents).toBe(900_000);
  });
});

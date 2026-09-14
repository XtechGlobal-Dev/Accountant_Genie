import { financialYearOf, financialYearRange } from "@/server/au/fy";
import type { DepreciationLine, DepreciationSchedule } from "@/shared/contracts/register";
import type { DepreciationMethod } from "@/shared/enums";

/**
 * Depreciation — pure, integer cents, one asset at a time.
 *
 * Two methods, as the ATO describes them for assets acquired after 10 May 2006:
 *
 *   Prime cost:        cost × (days held ÷ days in year) × (100% ÷ effective life)
 *   Diminishing value: opening value × (days held ÷ days in year) × (200% ÷ effective life)
 *
 * Private use reduces the deductible share, not the decline in value. A
 * mid-year purchase is pro-rated by days. Nothing here applies the instant
 * asset write-off, low-value pooling or a car limit — those are thresholds
 * that change with legislation and REQUIRE VERIFICATION by the registered
 * tax advisor before they are encoded.
 */

export interface DepreciableAsset {
  id: string;
  name: string;
  costCents: number;
  purchaseDate: Date;
  method: DepreciationMethod;
  effectiveLifeMonths: number;
  privateUseBasisPoints: number;
  disposedAt: Date | null;
  isCar?: boolean;
}

/**
 * Thresholds the registered tax advisor has verified. Absent means "not
 * verified, not applied" — the schedule then uses the plain method only and
 * the page says so. Never a default figure.
 */
export interface VerifiedThresholds {
  /** Assets up to this cost, bought in the year, are written off in full. */
  instantWriteOffCents?: number | null;
  /** The maximum depreciable cost of a car. */
  carLimitCents?: number | null;
}

const DAY = 86_400_000;

/** Round half away from zero to whole cents. */
function roundCents(value: number): number {
  const magnitude = Math.round(Math.abs(value));
  return value < 0 ? -magnitude : magnitude;
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY));
}

/** Days the asset was held inside one financial year. */
function daysHeldIn(asset: DepreciableAsset, fy: number): number {
  const range = financialYearRange(fy);
  const from = asset.purchaseDate > range.start ? asset.purchaseDate : range.start;
  const until = asset.disposedAt && asset.disposedAt < range.end ? asset.disposedAt : range.end;
  return daysBetween(from, until);
}

function daysInYear(fy: number): number {
  const range = financialYearRange(fy);
  return daysBetween(range.start, range.end);
}

/** The cost the schedule depreciates: the car limit, when verified and the asset is a car. */
export function depreciableCost(asset: DepreciableAsset, thresholds: VerifiedThresholds): number {
  const limit = thresholds.carLimitCents ?? null;
  if (asset.isCar && limit !== null && asset.costCents > limit) return limit;
  return asset.costCents;
}

/** The decline in value for one year, capped at what is left to decline. */
function declineFor(
  asset: DepreciableAsset,
  fy: number,
  openingCents: number,
  thresholds: VerifiedThresholds,
): number {
  if (openingCents <= 0 || asset.effectiveLifeMonths <= 0) return 0;
  const cost = depreciableCost(asset, thresholds);
  // A verified instant write-off: the whole cost in the year of purchase.
  const writeOff = thresholds.instantWriteOffCents ?? null;
  if (writeOff !== null && cost <= writeOff && financialYearOf(asset.purchaseDate) === fy) {
    return openingCents;
  }
  const fraction = daysHeldIn(asset, fy) / daysInYear(fy);
  const base = asset.method === "PRIME_COST" ? cost : openingCents;
  const ratePerYear = (asset.method === "PRIME_COST" ? 12 : 24) / asset.effectiveLifeMonths;
  return Math.min(openingCents, roundCents(base * fraction * ratePerYear));
}

/** One asset's line for a financial year, with everything before it already applied. */
export function depreciationFor(
  asset: DepreciableAsset,
  fy: number,
  thresholds: VerifiedThresholds = {},
): DepreciationLine | null {
  const firstFy = financialYearOf(asset.purchaseDate);
  if (fy < firstFy) return null;
  if (asset.disposedAt && financialYearOf(asset.disposedAt) < fy) return null;

  let opening = depreciableCost(asset, thresholds);
  for (let year = firstFy; year < fy; year += 1) {
    opening -= declineFor(asset, year, opening, thresholds);
  }

  const depreciationCents = declineFor(asset, fy, opening, thresholds);
  const deductibleCents = roundCents(
    (depreciationCents * (10_000 - asset.privateUseBasisPoints)) / 10_000,
  );

  return {
    assetId: asset.id,
    name: asset.name,
    method: asset.method,
    costCents: depreciableCost(asset, thresholds),
    openingCents: opening,
    depreciationCents,
    privateUseBasisPoints: asset.privateUseBasisPoints,
    deductibleCents,
    closingCents: opening - depreciationCents,
    daysHeld: daysHeldIn(asset, fy),
  };
}

export function depreciationSchedule(
  assets: readonly DepreciableAsset[],
  fy: number,
  thresholds: VerifiedThresholds = {},
): DepreciationSchedule {
  const lines = assets
    .map((asset) => depreciationFor(asset, fy, thresholds))
    .filter((line): line is DepreciationLine => line !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    fy,
    lines,
    totalDepreciationCents: lines.reduce((s, l) => s + l.depreciationCents, 0),
    totalDeductibleCents: lines.reduce((s, l) => s + l.deductibleCents, 0),
    totalClosingCents: lines.reduce((s, l) => s + l.closingCents, 0),
  };
}

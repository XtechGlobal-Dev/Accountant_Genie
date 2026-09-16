import type { GstTreatment } from "@/generated/prisma";
import { gstComponentCents } from "@/shared/gst-math";

/** Australian GST rate. */
export const GST_RATE = 0.1;

/** Tax codes that carry a 10% GST component. */
const GST_BEARING: ReadonlySet<GstTreatment> = new Set<GstTreatment>([
  "GST_ON_INCOME",
  "GST_ON_EXPENSES",
  "GST_ON_CAPITAL",
]);

/** Tax codes that represent money coming in. */
const INCOME_CODES: ReadonlySet<GstTreatment> = new Set<GstTreatment>([
  "GST_ON_INCOME",
  "GST_FREE_INCOME",
]);

/** Tax codes that represent money going out. */
const EXPENSE_CODES: ReadonlySet<GstTreatment> = new Set<GstTreatment>([
  "GST_ON_EXPENSES",
  "GST_FREE_EXPENSES",
  "GST_ON_CAPITAL",
  "GST_FREE_CAPITAL",
]);

export function isGstBearing(treatment: GstTreatment): boolean {
  return GST_BEARING.has(treatment);
}

export function isIncomeCode(treatment: GstTreatment): boolean {
  return INCOME_CODES.has(treatment);
}

export function isExpenseCode(treatment: GstTreatment): boolean {
  return EXPENSE_CODES.has(treatment);
}

/**
 * GST component of a GST-INCLUSIVE amount.
 *
 * Australian prices are quoted GST-inclusive, so the GST embedded in a gross
 * amount is `gross / 11` — NOT `gross * 0.10`. Getting this wrong overstates
 * GST by 10% on every transaction, which is the most common defect in
 * home-grown BAS code.
 *
 * Rounds half away from zero, matching ATO rounding, and preserves sign.
 */
export function gstFromGross(grossCents: number, treatment: GstTreatment): number {
  if (!isGstBearing(treatment)) return 0;
  return gstComponentCents(grossCents);
}

/** Amount excluding GST. */
export function netFromGross(grossCents: number, treatment: GstTreatment): number {
  return grossCents - gstFromGross(grossCents, treatment);
}

/** Split a gross amount into its net and GST parts in one pass. */
export function splitGst(
  grossCents: number,
  treatment: GstTreatment,
): { grossCents: number; gstCents: number; netCents: number } {
  const gstCents = gstFromGross(grossCents, treatment);
  return { grossCents, gstCents, netCents: grossCents - gstCents };
}

/** Add GST to a GST-exclusive amount. */
export function grossFromNet(netCents: number, treatment: GstTreatment): number {
  if (!isGstBearing(treatment)) return netCents;
  const magnitude = Math.round(Math.abs(netCents) * (1 + GST_RATE));
  return netCents < 0 ? -magnitude : magnitude;
}

/**
 * The gross amount of a journal line, signed from the tax code's natural side.
 *
 * Income codes are credit-natural: a credit to Sales is positive income and a
 * debit (a refund) is negative. Every other code is debit-natural. The posting
 * engine computes GST from this signed gross, so a refund carries negative GST
 * and the BAS nets it off instead of adding it on.
 */
export function naturalGross(
  treatment: GstTreatment,
  debitCents: number,
  creditCents: number,
): number {
  return isIncomeCode(treatment) ? creditCents - debitCents : debitCents - creditCents;
}

/** Labels shown in the UI live with the other display labels, in shared. */
export { GST_TREATMENT_LABELS } from "@/shared/labels";

// ---------------------------------------------------------------------------
// BAS label mapping
// ---------------------------------------------------------------------------

/**
 * Which Simple BAS labels a tax code contributes to.
 *
 * G1  Total sales (GST-inclusive)
 * G10 Capital purchases
 * G11 Non-capital purchases
 * 1A  GST on sales — amount owed to the ATO
 * 1B  GST on purchases — amount the ATO owes
 *
 * Not modelled here: W1/W2 (PAYG withholding) come from payroll accounts rather
 * than a tax code, and are derived separately in the BAS report.
 */
export type BasLabel = "G1" | "G10" | "G11" | "1A" | "1B";

const BAS_MAP: Record<GstTreatment, readonly BasLabel[]> = {
  GST_ON_INCOME: ["G1", "1A"],
  GST_FREE_INCOME: ["G1"],
  GST_ON_EXPENSES: ["G11", "1B"],
  GST_FREE_EXPENSES: ["G11"],
  GST_ON_CAPITAL: ["G10", "1B"],
  GST_FREE_CAPITAL: ["G10"],
  // Input-taxed supplies are not mapped by treatment alone: whether they are
  // a sale (G1) or a purchase (G11) depends on the account, and whether they
  // are included at all is the verified INPUT_TAXED_BAS_LABELS rule. The BAS
  // aggregator handles them explicitly — see reports/aggregate.ts. Until the
  // firm's advisor verifies the rule they contribute to no label, and the
  // statement says how many lines it left out.
  INPUT_TAXED: [],
  BAS_EXCLUDED: [],
  UNALLOCATED: [],
};

export function basLabelsFor(treatment: GstTreatment): readonly BasLabel[] {
  return BAS_MAP[treatment];
}

export function contributesTo(treatment: GstTreatment, label: BasLabel): boolean {
  return BAS_MAP[treatment].includes(label);
}

/** Treatments that contribute to any BAS figure at all. */
export function affectsBas(treatment: GstTreatment): boolean {
  return BAS_MAP[treatment].length > 0;
}

/**
 * A transaction may not reach a BAS while its treatment is unresolved.
 * The BAS report calls this and refuses to generate if anything is unallocated.
 */
export function isUnresolved(treatment: GstTreatment): boolean {
  return treatment === "UNALLOCATED";
}

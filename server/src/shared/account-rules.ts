/**
 * Rules for firm-created accounts that both the form and the server apply.
 *
 * Shared so the modal can explain a rule before the round trip and the schema
 * can enforce the same one after it — one definition, two readers.
 */

import type { AccountType, GstTreatment } from "@/shared/enums";

/** System accounts occupy 0–999. A firm's own accounts sit above them. */
export const CUSTOM_ACCOUNT_CODE_FLOOR = 1000;
export const CUSTOM_ACCOUNT_CODE_CEILING = 9999;

/** Every type a person may create an account under. UNKNOWN is sentinel-only. */
export type CreatableAccountType = Exclude<AccountType, "UNKNOWN">;

export const CREATABLE_ACCOUNT_TYPES: readonly CreatableAccountType[] = [
  "INCOME",
  "COGS",
  "EXPENSE",
  "ASSET",
  "LIABILITY",
  "EQUITY",
];

/**
 * Which tax codes make sense on which kind of account.
 *
 * An income account coded "GST on Expenses" would report sales at G11, which
 * is not a preference, it is a wrong BAS. The lists are deliberately narrow;
 * an accountant who needs a treatment outside them is describing a different
 * kind of account.
 */
export const TREATMENTS_BY_TYPE: Record<CreatableAccountType, readonly GstTreatment[]> = {
  INCOME: ["GST_ON_INCOME", "GST_FREE_INCOME", "INPUT_TAXED", "BAS_EXCLUDED"],
  COGS: ["GST_ON_EXPENSES", "GST_FREE_EXPENSES", "INPUT_TAXED", "BAS_EXCLUDED"],
  EXPENSE: ["GST_ON_EXPENSES", "GST_FREE_EXPENSES", "INPUT_TAXED", "BAS_EXCLUDED"],
  ASSET: ["GST_ON_CAPITAL", "GST_FREE_CAPITAL", "BAS_EXCLUDED"],
  LIABILITY: ["BAS_EXCLUDED"],
  EQUITY: ["BAS_EXCLUDED"],
};

export function treatmentAllowedFor(
  type: CreatableAccountType,
  treatment: GstTreatment,
): boolean {
  return TREATMENTS_BY_TYPE[type].includes(treatment);
}

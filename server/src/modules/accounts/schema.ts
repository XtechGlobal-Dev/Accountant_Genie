import { z } from "zod";
import {
  CREATABLE_ACCOUNT_TYPES,
  CUSTOM_ACCOUNT_CODE_CEILING,
  CUSTOM_ACCOUNT_CODE_FLOOR,
  treatmentAllowedFor,
} from "@/shared/account-rules";

/**
 * Input contracts for firm-created accounts.
 *
 * System accounts are seeded, never created through this module, so the
 * schema does not know about UNKNOWN or UNALLOCATED at all: a sentinel cannot
 * be created by mistake because it cannot be expressed.
 */

export const CreatableAccountTypeEnum = z.enum(CREATABLE_ACCOUNT_TYPES);

export const GstTreatmentEnum = z.enum([
  "GST_ON_INCOME",
  "GST_FREE_INCOME",
  "GST_ON_EXPENSES",
  "GST_FREE_EXPENSES",
  "GST_ON_CAPITAL",
  "GST_FREE_CAPITAL",
  "INPUT_TAXED",
  "BAS_EXCLUDED",
]);

export const CustomAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Give the account a name").max(120),
    code: z.coerce
      .number()
      .int("The code must be a whole number")
      .min(
        CUSTOM_ACCOUNT_CODE_FLOOR,
        `Custom codes start at ${CUSTOM_ACCOUNT_CODE_FLOOR}; lower codes are reserved for system accounts`,
      )
      .max(CUSTOM_ACCOUNT_CODE_CEILING, `Codes go up to ${CUSTOM_ACCOUNT_CODE_CEILING}`),
    type: CreatableAccountTypeEnum,
    gstTreatment: GstTreatmentEnum,
    description: z.string().trim().max(300).optional(),
    /** Empty = every client of the firm. */
    clientId: z.string().trim().max(64).optional(),
    /** The row version the form was opened with; an edit against a newer row is refused. */
    version: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => treatmentAllowedFor(v.type, v.gstTreatment), {
    path: ["gstTreatment"],
    message: "That tax code does not apply to this kind of account",
  });

export type CustomAccountInput = z.infer<typeof CustomAccountSchema>;

const text = (form: FormData, key: string) => form.get(key) ?? "";

export function customAccountFromForm(form: FormData) {
  return CustomAccountSchema.safeParse({
    name: form.get("name"),
    code: form.get("code"),
    type: form.get("type"),
    gstTreatment: form.get("gstTreatment"),
    description: text(form, "description"),
    clientId: text(form, "clientId"),
    version: text(form, "version") || undefined,
  });
}

import { z } from "zod";

/** Input contracts for the banking module. */

export const BankAccountKindEnum = z.enum(["BANK", "CREDIT_CARD"]);

export const BankAccountSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(120),
  kind: BankAccountKindEnum,
  // Last four digits only. A full account number is never stored or logged.
  accountMask: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .refine((v) => v === "" || /^\d{3,4}$/.test(v), "Enter the last 3–4 digits only")
    .optional(),
  isCashAtBank: z.coerce.boolean(),
});

export type BankAccountInput = z.infer<typeof BankAccountSchema>;

export function bankAccountFromForm(form: FormData) {
  return BankAccountSchema.safeParse({
    name: form.get("name"),
    kind: form.get("kind"),
    accountMask: form.get("accountMask") ?? "",
    isCashAtBank: form.get("isCashAtBank") === "yes",
  });
}

/* -------------------------------------------------------------------------- */
/* Live feeds                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Starting a consent.
 *
 * The email is the address Fiskil uses to identify the client's end user and
 * to send them the one-time code during the CDR flow, so it has to be one the
 * person at the bank can actually read — not necessarily the firm's contact
 * address for that client.
 */
export const FeedConnectionSchema = z.object({
  email: z
    .string()
    .trim()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address"),
  /** Pre-selects the bank so the client skips the institution picker. */
  institutionId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Set to re-authorise an existing arrangement instead of creating one. */
  renewConnectionId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type FeedConnectionInput = z.infer<typeof FeedConnectionSchema>;

export function feedConnectionFromForm(form: FormData) {
  return FeedConnectionSchema.safeParse({
    email: form.get("email") ?? "",
    institutionId: form.get("institutionId") ?? "",
    renewConnectionId: form.get("renewConnectionId") ?? "",
  });
}

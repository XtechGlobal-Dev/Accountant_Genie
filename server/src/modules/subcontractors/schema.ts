import { z } from "zod";
import { isValidAbn } from "@/server/au/abn";

/** Input contracts for the subcontractor register. */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const SubcontractorSchema = z.object({
  name: z.string().trim().min(1, "The subcontractor needs a name").max(200),
  abn: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    // Eleven digits is not an ABN: the modulus-89 checksum is what catches a
  // mistyped or transposed digit before it reaches a TPAR. See au/abn.ts.
  .refine((v) => v === "" || isValidAbn(v), "That is not a valid ABN — check the digits")
    .optional(),
  email: optionalText(200).refine((v) => !v || EMAIL.test(v), "Enter a valid email address"),
  phone: optionalText(40),
  address: optionalText(300),
});

export type SubcontractorInput = z.infer<typeof SubcontractorSchema>;

const text = (form: FormData, key: string) => form.get(key) ?? "";

export function subcontractorFromForm(form: FormData) {
  return SubcontractorSchema.safeParse({
    name: form.get("name"),
    abn: text(form, "abn"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    address: text(form, "address"),
  });
}

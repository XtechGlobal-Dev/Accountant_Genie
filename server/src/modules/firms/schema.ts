import { z } from "zod";
import { isValidAbn } from "@/server/au/abn";

/** Input contracts for firm and profile settings. */

const abnField = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  // Eleven digits is not an ABN: the modulus-89 checksum is what catches a
  // mistyped or transposed digit before it reaches a TPAR. See au/abn.ts.
  .refine((v) => v === "" || isValidAbn(v), "That is not a valid ABN — check the digits");

export const UpdateFirmSchema = z.object({
  name: z.string().trim().min(1, "The firm needs a name").max(200),
  abn: abnField,
});

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
});

export type UpdateFirmInput = z.infer<typeof UpdateFirmSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export function updateFirmFromForm(form: FormData) {
  return UpdateFirmSchema.safeParse({
    name: form.get("name"),
    abn: form.get("abn") ?? "",
  });
}

export function updateProfileFromForm(form: FormData) {
  return UpdateProfileSchema.safeParse({ name: form.get("name") });
}

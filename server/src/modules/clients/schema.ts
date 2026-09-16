import { z } from "zod";
import { isValidAbn } from "@/server/au/abn";

/**
 * Input contracts for the clients module.
 *
 * Validation lives here rather than in the action so it can be tested without a
 * request, and so the same rule is applied whether input arrives from a form, a
 * future API route, or an import. Actions parse; services trust.
 */

export const EntityEnum = z.enum([
  "COMPANY",
  "PARTNERSHIP",
  "SOLE_TRADER",
  "UNIT_TRUST",
  "DISCRETIONARY_TRUST",
]);
export const GstBasisEnum = z.enum(["CASH", "ACCRUAL"]);
export const BasFrequencyEnum = z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]);

/** Permissive on shape, strict on obvious nonsense — a typo here is not a tax risk. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const abnField = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  // Eleven digits is not an ABN: the modulus-89 checksum is what catches a
  // mistyped or transposed digit before it reaches a TPAR. See au/abn.ts.
  .refine((v) => v === "" || isValidAbn(v), "That is not a valid ABN — check the digits")
  .optional();

/**
 * A client's own ABN is required: every report, BAS and TPAR prepared here is
 * prepared for a business, and a business the firm keeps books for has one.
 * A trustee's ABN stays optional above — an individual trustee has none.
 */
const requiredAbnField = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  .refine((v) => v !== "", "ABN is required")
  .refine((v) => v === "" || isValidAbn(v), "That is not a valid ABN — check the digits");

/** Fields only some entity types own. Cleared by the service for the others. */
const entitySpecific = {
  incomeTaxRatePercent: z.coerce.number().int().min(0).max(100).optional(),
  totalUnits: z.coerce.number().int().min(0).optional(),
  unitValueCents: z.coerce.number().int().min(0).optional(),
};

export const CreateClientSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  abn: requiredAbnField,
  gstRegistered: z.coerce.boolean(),
  industry: optionalText(120),
  entityType: EntityEnum,
  ...entitySpecific,
});

export const UpdateClientSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  legalName: optionalText(200),
  abn: requiredAbnField,
  industry: optionalText(120),
  email: optionalText(200).refine((v) => !v || EMAIL.test(v), "Enter a valid email address"),
  phone: optionalText(40),
  /** The row version the form was opened with; a stale edit is refused, not merged. */
  version: z.coerce.number().int().min(0).optional(),
  entityType: EntityEnum,
  gstRegistered: z.coerce.boolean(),
  gstBasis: GstBasisEnum,
  basFrequency: BasFrequencyEnum,
  ...entitySpecific,
});

export const ClientNoteSchema = z.object({
  title: z.string().trim().min(1, "A note needs a title").max(120),
  body: z.string().trim().min(1, "A note needs a body").max(4000),
});

/**
 * The partners of a PARTNERSHIP client and their shares, in basis points.
 *
 * The shares must sum to exactly 10 000 (100.00%). Not "about 100" — a
 * partnership distribution that is out by a basis point is a distribution
 * that does not reconcile, and the form has already shown the running total.
 */
export const PartnerSchema = z.object({
  name: z.string().trim().min(1, "Every partner needs a name").max(120),
  shareBasisPoints: z
    .number()
    .int("Shares are whole hundredths of a percent")
    .min(1, "A partner's share must be above 0%")
    .max(10_000, "A partner's share cannot exceed 100%"),
});

export const PartnersSchema = z
  .object({
    partners: z
      .array(PartnerSchema)
      .min(1, "A partnership needs at least one partner")
      .max(50, "That is more partners than a partnership can hold"),
  })
  .refine(
    (v) => v.partners.reduce((sum, partner) => sum + partner.shareBasisPoints, 0) === 10_000,
    { path: ["partners"], message: "Partner shares must add up to exactly 100%" },
  );

/**
 * The trustee and beneficiaries of a UNIT_TRUST or DISCRETIONARY_TRUST client.
 *
 * Saved as one set, like partners: a trust with a trustee and no beneficiary
 * is not a trust anyone can distribute from, so the form cannot save half.
 * Names are people or entities the accountant types; the ABN of a corporate
 * trustee gets the same checksum as the client's own.
 */
export const TrusteeKindEnum = z.enum(["CORPORATE", "INDIVIDUAL"]);
export const BeneficiaryKindEnum = z.enum(["INDIVIDUAL", "COMPANY", "TRUST"]);

const personName = (what: string) => z.string().trim().min(1, `${what} needs a name`).max(120);

export const TrustDetailsSchema = z.object({
  trustee: z.object({
    kind: TrusteeKindEnum,
    name: z.string().trim().min(1, "The trustee needs a name").max(200),
    abn: abnField,
    signatories: z
      .array(personName("Every signatory"))
      .max(20, "That is more signatories than a trustee can hold"),
  }),
  beneficiaries: z
    .array(
      z.object({
        name: personName("Every beneficiary"),
        kind: BeneficiaryKindEnum,
      }),
    )
    .min(1, "A trust needs at least one beneficiary")
    .max(100, "That is more beneficiaries than a trust can hold"),
});

/** The entity types that carry a trustee and beneficiaries. */
export const TRUST_ENTITIES: ReadonlySet<string> = new Set(["UNIT_TRUST", "DISCRETIONARY_TRUST"]);

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
export type ClientNoteInput = z.infer<typeof ClientNoteSchema>;
export type PartnersInput = z.infer<typeof PartnersSchema>;
export type TrustDetailsInput = z.infer<typeof TrustDetailsSchema>;

/* -------------------------------------------------------------------------- */
/* Form adapters                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `FormData` is a transport detail, so the mapping from it lives at the edge of
 * this module and the schemas above stay usable from anywhere.
 *
 * An empty string is not the same as an absent value: `""` would fail
 * `z.coerce.number()`, so blank optional numerics become `undefined` here.
 */
const text = (form: FormData, key: string) => form.get(key) ?? "";
const numeric = (form: FormData, key: string) => form.get(key) || undefined;
const checkbox = (form: FormData, key: string) => form.get(key) === "yes";

export function createClientFromForm(form: FormData) {
  return CreateClientSchema.safeParse({
    businessName: form.get("businessName"),
    abn: text(form, "abn"),
    gstRegistered: checkbox(form, "gstRegistered"),
    industry: text(form, "industry"),
    entityType: form.get("entityType"),
    incomeTaxRatePercent: numeric(form, "incomeTaxRatePercent"),
    totalUnits: numeric(form, "totalUnits"),
    unitValueCents: numeric(form, "unitValueCents"),
  });
}

export function updateClientFromForm(form: FormData) {
  return UpdateClientSchema.safeParse({
    businessName: form.get("businessName"),
    legalName: text(form, "legalName"),
    abn: text(form, "abn"),
    industry: text(form, "industry"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    entityType: form.get("entityType"),
    gstRegistered: checkbox(form, "gstRegistered"),
    gstBasis: form.get("gstBasis"),
    basFrequency: form.get("basFrequency"),
    incomeTaxRatePercent: numeric(form, "incomeTaxRatePercent"),
    totalUnits: numeric(form, "totalUnits"),
    unitValueCents: numeric(form, "unitValueCents"),
    version: numeric(form, "version"),
  });
}

export function clientNoteFromForm(form: FormData) {
  return ClientNoteSchema.safeParse({
    title: form.get("title"),
    body: form.get("body"),
  });
}

import { z } from "zod";

/** Input contracts for authentication. */

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

/** Length is the rule that matters; composition rules push people to weaker, memorable patterns. */
const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That is longer than a password needs to be");

export const SignInSchema = z.object({ email, password: z.string().min(1, "Enter your password").max(200) });

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export const PROFESSIONAL_BODIES = [
  "CA_ANZ",
  "CPA_AUSTRALIA",
  "IPA",
  "ATMA",
  "TPB",
  "NTAA",
  "OTHER",
] as const;

export const HEARD_FROM = [
  "SOCIAL_MEDIA",
  "BLOG_OR_ARTICLE",
  "COMMUNITY_EVENTS",
  "FRIENDS_AND_COLLEAGUES",
  "OTHER",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Australian mobile or landline, stored as typed minus spacing.
 *
 * Deliberately permissive: a practice may hold an overseas number, and
 * rejecting a real phone number to enforce a format is a worse failure than
 * storing one we cannot parse.
 */
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^\+?\d{6,15}$/.test(v), "Enter a valid phone number")
  .optional()
  .transform((v) => (v ? v : undefined));

export const SignUpSchema = z
  .object({
    firmName: z.string().trim().min(1, "The firm needs a name").max(200),
    name: z.string().trim().min(1, "Your name is required").max(120),
    email,
    password,
    phone,
    /** Drives state-based obligations, so it is asked rather than inferred. */
    state: z.enum(AU_STATES, { message: "Select the state you practise in" }),
    professionalTitle: optionalText(120),
    /**
     * Registration is regulated conduct, not a preference: preparing BAS for a
     * fee requires it. The answer decides whether this person may verify a tax
     * rule, so it is required rather than defaulted.
     */
    isTaxAgent: z.coerce.boolean(),
    professionalBody: z
      .union([z.enum(PROFESSIONAL_BODIES), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    agentNumber: optionalText(40),
    howHeard: z
      .union([z.enum(HEARD_FROM), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .superRefine((value, ctx) => {
    // Saying yes without saying which body leaves a permission switched on and
    // nothing evidencing it. The pair travels together or not at all.
    if (!value.isTaxAgent) return;
    if (!value.professionalBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["professionalBody"],
        message: "Select the body you are registered with",
      });
    }
    if (!value.agentNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agentNumber"],
        message: "Enter your registration number",
      });
    }
  });

export type SignUpInput = z.infer<typeof SignUpSchema>;

export const OtpSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => /^\d{6}$/.test(v), "Enter the six-digit code"),
  /**
   * "Remember this device for 30 days". Opt-in, and it only ever skips the
   * code on this browser — the password is still asked for every time.
   */
  remember: z.coerce.boolean(),
});

export const ForgotSchema = z.object({ email });

export const ResetPasswordSchema = z.object({
  code: OtpSchema.shape.code,
  password,
});

export const ChangePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password").max(200),
    password,
    confirm: z.string().max(200),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match" });

export const InviteSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(120),
  email,
  role: z.enum(["ADMIN", "ACCOUNTANT", "BOOKKEEPER", "STAFF", "VIEWER"]),
});

export const RoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "STAFF", "VIEWER"]),
});

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export const fromForm = {
  signIn: (f: FormData) => SignInSchema.safeParse({ email: text(f, "email"), password: text(f, "password") }),
  signUp: (f: FormData) =>
    SignUpSchema.safeParse({
      firmName: text(f, "firmName"),
      name: text(f, "name"),
      email: text(f, "email"),
      password: text(f, "password"),
      phone: text(f, "phone"),
      state: text(f, "state"),
      professionalTitle: text(f, "professionalTitle"),
      isTaxAgent: text(f, "isTaxAgent") === "yes",
      professionalBody: text(f, "professionalBody"),
      agentNumber: text(f, "agentNumber"),
      howHeard: text(f, "howHeard"),
    }),
  otp: (f: FormData) => OtpSchema.safeParse({ code: text(f, "code"), remember: text(f, "remember") === "yes" }),
  forgot: (f: FormData) => ForgotSchema.safeParse({ email: text(f, "email") }),
  reset: (f: FormData) => ResetPasswordSchema.safeParse({ code: text(f, "code"), password: text(f, "password") }),
  changePassword: (f: FormData) =>
    ChangePasswordSchema.safeParse({
      current: text(f, "current"),
      password: text(f, "password"),
      confirm: text(f, "confirm"),
    }),
  invite: (f: FormData) => InviteSchema.safeParse({ name: text(f, "name"), email: text(f, "email"), role: text(f, "role") }),
  role: (f: FormData) => RoleSchema.safeParse({ role: text(f, "role") }),
};

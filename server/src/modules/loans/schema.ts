import { z } from "zod";
import { CalendarDateSchema } from "@/server/modules/ledger/schema";
import { parseBasisPoints, parseCents } from "@/shared/money";

/** Input contracts for the loan register. Dollars and percentages are parsed at this edge. */

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseCents(v);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", message: `Enter the ${label} in dollars and cents` });
        return z.NEVER;
      }
      return cents;
    });

export const LoanTypeEnum = z.enum(["EQUIPMENT_FINANCE", "EQUIPMENT_FINANCE_LONG_TERM", "BANK_LOAN_LONG_TERM", "BANK_LOAN"]);

export const LoanSchema = z.object({
  type: LoanTypeEnum,
  lender: z.string().trim().min(1, "Who is the loan from?").max(200),
  description: z.string().trim().max(300).optional(),
  principalCents: money("amount borrowed"),
  interestRateBasisPoints: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const bps = parseBasisPoints(v);
      if (bps === null || bps > 10_000) {
        ctx.addIssue({ code: "custom", message: "Enter the annual interest rate as a percentage" });
        return z.NEVER;
      }
      return bps;
    }),
  startDate: CalendarDateSchema,
  termMonths: z.coerce.number().int("Whole months").min(1, "At least one month").max(600, "At most 50 years"),
  repaymentCents: money("repayment"),
  frequency: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]),
  accountId: z.string().trim().max(64).optional(),
});

export type LoanInput = z.infer<typeof LoanSchema>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export function loanFromForm(form: FormData) {
  return LoanSchema.safeParse({
    type: form.get("type"),
    lender: form.get("lender"),
    description: text(form, "description"),
    principalCents: text(form, "principal"),
    interestRateBasisPoints: text(form, "interestRate"),
    startDate: text(form, "startDate"),
    termMonths: text(form, "termMonths"),
    repaymentCents: text(form, "repayment"),
    frequency: form.get("frequency"),
    accountId: text(form, "accountId"),
  });
}

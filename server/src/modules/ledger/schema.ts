import { z } from "zod";
import { MAX_LINES, MAX_LINE_CENTS, MIN_LINES, checkJournalShape } from "./validate";

/**
 * Input contracts for the ledger.
 *
 * The journal form posts a plain object, not FormData: a journal is a list of
 * lines, and a flat key/value transport would need a naming convention that
 * the schema then has to reverse. Cents arrive as integers; the form converted
 * them with `@/shared/money` and the schema refuses anything else.
 */

/** `YYYY-MM-DD` → a UTC midnight `Date`, rejecting impossible calendar dates. */
export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .transform((value, ctx) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    const valid =
      date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    if (!valid || y < 1990 || y > 2100) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return date;
  });

const cents = z
  .number()
  .int("Amounts must be whole cents")
  .min(0, "Amounts cannot be negative — use the other column")
  .max(MAX_LINE_CENTS, "That amount is too large for a single line");

export const JournalLineSchema = z.object({
  accountId: z.string().trim().min(1, "Choose an account").max(64),
  description: z.string().trim().max(300).optional(),
  debitCents: cents,
  creditCents: cents,
  /** For TPAR: the subcontractor a payment went to. */
  subcontractorId: z.string().trim().max(64).optional(),
});

export const JournalInputSchema = z
  .object({
    date: CalendarDateSchema,
    reference: z.string().trim().max(60).optional(),
    description: z.string().trim().max(300).optional(),
    source: z.enum(["MANUAL", "OPENING"]),
    lines: z
      .array(JournalLineSchema)
      .min(MIN_LINES, `A journal needs at least ${MIN_LINES} lines`)
      .max(MAX_LINES, `A journal may have at most ${MAX_LINES} lines`),
  })
  .superRefine((value, ctx) => {
    const problem = checkJournalShape(value.lines);
    if (problem) {
      ctx.addIssue({
        code: "custom",
        message: problem.message,
        path: problem.line === undefined ? ["lines"] : ["lines", problem.line],
      });
    }
  });

export type JournalInputParsed = z.infer<typeof JournalInputSchema>;

export const ReverseJournalSchema = z.object({
  date: CalendarDateSchema,
});

export type ReverseJournalParsed = z.infer<typeof ReverseJournalSchema>;

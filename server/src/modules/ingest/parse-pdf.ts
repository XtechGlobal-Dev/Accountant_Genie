import type { FailedRow, ParsedRow, ParseResult } from "./parse";
import { normaliseDescription, parseStatementAmount, parseStatementDate } from "./parse";

/**
 * Statement rows out of PDF text — pure, over the text a PDF yields.
 *
 * A text-based bank statement lays each transaction on a line: a date, the
 * description, then one or two amounts at the end (the amount, and usually
 * the running balance). Banks differ on how they show direction — a minus
 * sign, a DR/CR suffix, or nothing at all with the balance doing the work —
 * so the sign is taken from the balance movement whenever a balance is
 * present, and from the amount's own sign otherwise.
 *
 * Multi-line descriptions are folded into the preceding transaction. Lines
 * with a date but no readable amount are reported, not guessed. Scanned
 * (image-only) PDFs yield no text and are refused with a clear reason.
 */

const AMOUNT = String.raw`\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?(?:\s?(?:DR|CR))?`;
const TRAILING_AMOUNTS = new RegExp(String.raw`^(.*?)\s+(${AMOUNT})(?:\s+(${AMOUNT}))?\s*$`, "i");
const LEADING_DATE = /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2} [A-Za-z]{3,4} \d{2,4}|\d{4}-\d{2}-\d{2})\s+(.*)$/;
const OPENING = /opening balance|balance brought forward|balance b\/f/i;
const CLOSING = /closing balance|balance carried forward|balance c\/f|total/i;

interface Draft {
  index: number;
  date: Date;
  description: string;
  amountCents: number;
  balanceCents: number | null;
  /** Whether the amount's sign came from the statement itself. */
  signed: boolean;
}

export function parseStatementPdfText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");

  const drafts: Draft[] = [];
  const failed: FailedRow[] = [];
  const seed: { opening: number | null } = { opening: null };

  lines.forEach((line, index) => {
    const dated = LEADING_DATE.exec(line);
    if (!dated) {
      // An opening balance line seeds the sign inference.
      if (OPENING.test(line)) {
        const m = TRAILING_AMOUNTS.exec(line);
        const value = m ? parseStatementAmount(m[3] ?? m[2]) : null;
        if (value !== null) seed.opening = value;
        return;
      }
      // A continuation of the previous transaction's description.
      const last = drafts.at(-1);
      if (last && !CLOSING.test(line) && !TRAILING_AMOUNTS.test(line)) {
        last.description = `${last.description} ${line}`.trim();
      }
      return;
    }

    const date = parseStatementDate(dated[1]!);
    if (!date) return;
    const rest = dated[2]!;
    if (OPENING.test(rest)) {
      const m = TRAILING_AMOUNTS.exec(rest);
      const value = m ? parseStatementAmount(m[3] ?? m[2]) : null;
      if (value !== null) seed.opening = value;
      return;
    }
    if (CLOSING.test(rest)) return;

    const m = TRAILING_AMOUNTS.exec(rest);
    if (!m) {
      failed.push({ index, reason: "No amount found on a dated line", raw: line });
      return;
    }
    const description = m[1]!.trim();
    const first = parseStatementAmount(m[2]);
    const second = m[3] !== undefined ? parseStatementAmount(m[3]) : null;
    if (first === null) {
      failed.push({ index, reason: "Unreadable amount", raw: line });
      return;
    }
    const explicitSign = /^-|^\(|\bDR\b/i.test(m[2]!) || /\bCR\b/i.test(m[2]!);
    drafts.push({
      index,
      date,
      description: description || "Transaction",
      amountCents: first,
      balanceCents: second,
      signed: explicitSign,
    });
  });

  // Direction from the running balance where the statement gives one.
  let previous = seed.opening;
  for (const draft of drafts) {
    if (draft.balanceCents !== null && previous !== null && !draft.signed) {
      const delta = draft.balanceCents - previous;
      if (Math.abs(Math.abs(delta) - Math.abs(draft.amountCents)) <= 1) {
        draft.amountCents = delta < 0 ? -Math.abs(draft.amountCents) : Math.abs(draft.amountCents);
      }
    }
    if (draft.balanceCents !== null) previous = draft.balanceCents;
  }

  const rows: ParsedRow[] = drafts.map((draft) => ({
    index: draft.index,
    date: draft.date,
    description: draft.description,
    normalised: normaliseDescription(draft.description),
    amountCents: draft.amountCents,
    balanceCents: draft.balanceCents,
  }));

  if (rows.length === 0 && failed.length === 0) {
    failed.push({
      index: 0,
      reason: "No transaction lines were found. If the statement is a scanned image it has no text to read.",
      raw: "",
    });
  }

  return { rows, failed, columns: { date: "pdf", description: "pdf", amount: "pdf", positional: true } };
}

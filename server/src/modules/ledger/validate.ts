/**
 * The double-entry invariant, as a pure function.
 *
 * No I/O and no Zod, so it is testable in isolation and callable from the
 * schema, the service and any future importer. The service applies it again
 * even though the schema already has — the invariant is cheap, and the cost of
 * trusting a caller is an unbalanced ledger.
 *
 * See .claude/skills/double-entry-ledger/SKILL.md.
 */

export interface LineAmounts {
  readonly debitCents: number;
  readonly creditCents: number;
}

export interface JournalShapeError {
  readonly message: string;
  /** Zero-based index of the offending line, when one line is at fault. */
  readonly line?: number;
}

export const MIN_LINES = 2;
export const MAX_LINES = 200;

/** Prisma `Int` — a single line is capped near $21.4M. */
export const MAX_LINE_CENTS = 2_147_483_647;

export function journalTotals(lines: readonly LineAmounts[]) {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    debitCents += line.debitCents;
    creditCents += line.creditCents;
  }
  return { debitCents, creditCents, differenceCents: debitCents - creditCents };
}

function isCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_LINE_CENTS;
}

/**
 * `null` when the lines form a valid journal; otherwise the first problem.
 *
 * Rules, in the order they are reported:
 *  - at least two lines, at most MAX_LINES
 *  - every amount is a non-negative integer number of cents within range
 *  - exactly one of debit / credit is non-zero on every line
 *  - debits equal credits
 *  - the journal moves money (a zero-value journal is not a journal)
 */
export function checkJournalShape(lines: readonly LineAmounts[]): JournalShapeError | null {
  if (lines.length < MIN_LINES) {
    return { message: `A journal needs at least ${MIN_LINES} lines` };
  }
  if (lines.length > MAX_LINES) {
    return { message: `A journal may have at most ${MAX_LINES} lines` };
  }

  for (const [index, line] of lines.entries()) {
    if (!isCents(line.debitCents) || !isCents(line.creditCents)) {
      return { message: "Amounts must be whole cents and within range", line: index };
    }
    const hasDebit = line.debitCents > 0;
    const hasCredit = line.creditCents > 0;
    if (hasDebit && hasCredit) {
      return { message: "A line is either a debit or a credit, not both", line: index };
    }
    if (!hasDebit && !hasCredit) {
      return { message: "Every line needs a debit or a credit amount", line: index };
    }
  }

  const totals = journalTotals(lines);
  if (totals.differenceCents !== 0) {
    return { message: "Debits must equal credits before the journal can be posted" };
  }
  if (totals.debitCents === 0) {
    return { message: "A journal must move money" };
  }

  return null;
}

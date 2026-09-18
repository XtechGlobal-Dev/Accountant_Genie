import type { GstTreatment } from "@/shared/enums";

/**
 * A posted journal, shown the way an accountant reads one.
 *
 * The ledger posts GROSS: an expense line carries $550 with the $50 of GST
 * recorded on it, against $550 from the bank. Read as a journal that looks
 * like an expense of $550, which it is not. This splits each line for
 * display into what the P&L sees — the net — and the GST the ATO sees,
 * on its own line against the GST control account:
 *
 *     Office Supplies    500.00                  Business Bank    550.00
 *     GST Receivable      50.00
 *
 * Nothing here is new arithmetic. `net = gross − gst` is the same
 * subtraction the reporting layer makes for the P&L, and the GST is the
 * figure the posting engine snapshotted on the line. The split is
 * presentation only; the ledger row is unchanged.
 *
 * Shared, so the server can render it and a test can pin it.
 */

export interface PostedLineLike {
  readonly accountCode: number;
  readonly accountName: string;
  readonly debitCents: number;
  readonly creditCents: number;
  /** Signed from the account's natural side, as the posting engine stored it. */
  readonly gstCents: number;
  readonly gstTreatment: GstTreatment | null;
}

export interface DisplayLine {
  readonly accountCode: number | null;
  readonly accountName: string;
  /** Always positive; which side is given by the list it sits in. */
  readonly cents: number;
  /** True for the GST line split out of a gross posting. */
  readonly isGst: boolean;
}

export interface PresentedJournal {
  readonly debits: DisplayLine[];
  readonly credits: DisplayLine[];
}

/** The two GST control accounts, by the names the chart gives them. */
export const GST_RECEIVABLE_LABEL = "GST Receivable";
export const GST_PAYABLE_LABEL = "GST Payable";

/** GST collected on a sale is owed to the ATO; GST paid on anything else is claimable. */
function gstControlLabel(treatment: GstTreatment | null): string {
  return treatment === "GST_ON_INCOME" ? GST_PAYABLE_LABEL : GST_RECEIVABLE_LABEL;
}

export function presentJournal(lines: readonly PostedLineLike[]): PresentedJournal {
  const debits: DisplayLine[] = [];
  const credits: DisplayLine[] = [];

  for (const line of lines) {
    // A posted line has exactly one side non-zero — the ledger's own rule.
    const isDebit = line.debitCents > 0;
    const gross = isDebit ? line.debitCents : line.creditCents;
    const side = isDebit ? debits : credits;
    const gst = Math.abs(line.gstCents);

    if (gst === 0 || gst >= gross) {
      side.push({ accountCode: line.accountCode, accountName: line.accountName, cents: gross, isGst: false });
      continue;
    }

    // The GST sits on the same side as the gross it came out of: a debit to
    // an expense splits into a debit to the expense and a debit to GST
    // Receivable; a credit refund on that expense splits the other way.
    side.push({ accountCode: line.accountCode, accountName: line.accountName, cents: gross - gst, isGst: false });
    side.push({ accountCode: null, accountName: gstControlLabel(line.gstTreatment), cents: gst, isGst: true });
  }

  return { debits, credits };
}

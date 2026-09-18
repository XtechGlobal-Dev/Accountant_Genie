import type { GstTreatment } from "@/shared/enums";
import { snapshotGst } from "./snapshot";
import { checkJournalShape, journalTotals, type JournalShapeError } from "./validate";

/**
 * The journal engine — pure.
 *
 * Given a bank transaction's direction and amount, the account(s) it is coded
 * to with their tax treatments, and the ledger account that stands for the
 * bank, this produces the lines of the balanced entry that posting will
 * write. Nothing here is a suggestion: the sides come from the sign of the
 * amount, the GST from the deterministic engine, and the bank line mirrors
 * the total. A model never chooses a debit or a credit; it chooses an
 * account and a tax code, and this turns that into accounting.
 *
 * Two callers, one function. `postBankTransactionInTx` builds the lines it
 * writes from here, and the reconciliation engine builds them the same way
 * as a dry run before it may call a coding "Ready to accept" — so a coding
 * that could not post is never presented as one that can.
 *
 * Lines are GROSS with the GST snapshotted on the line, which is how this
 * ledger records tax (the P&L reads gross − gst; the BAS reads gst). The
 * journals page splits the GST out for display — see
 * `shared/journal-presentation.ts`.
 */

/** One side of a bank posting: an account, how much of the amount, and its treatment. */
export interface BankAllocation {
  accountId: string;
  /** Magnitude, never signed. The allocations of one posting sum to the amount. */
  cents: number;
  gstTreatment: GstTreatment;
  subcontractorId?: string | null | undefined;
  description?: string | null | undefined;
}

export interface BankJournalInput {
  /** Signed: negative is money out of the bank. */
  amountCents: number;
  gstRegistered: boolean;
  /** The ledger account that stands for the bank account (Cash at Bank, Credit Card). */
  bankLedgerAccountId: string;
  allocations: readonly BankAllocation[];
  /** The bank transaction being posted, stamped on every line for lineage. */
  bankTransactionId: string | null;
}

export interface BankJournalLine {
  accountId: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
  /** Signed from the account's natural side, as the reports expect it. */
  gstCents: number;
  gstTreatment: GstTreatment;
  subcontractorId: string | null;
  bankTransactionId: string | null;
}

export type BankJournal =
  | { ok: true; lines: BankJournalLine[]; totalCents: number; gstCents: number }
  | { ok: false; error: string };

/**
 * Build and validate the lines. Never throws: an impossible posting is a
 * value the caller decides what to do with — the engine routes to review,
 * the posting path refuses.
 */
export function buildBankJournal(input: BankJournalInput): BankJournal {
  const magnitude = Math.abs(input.amountCents);
  if (!Number.isInteger(input.amountCents)) return { ok: false, error: "The amount must be whole cents" };
  if (magnitude === 0) return { ok: false, error: "A zero-value transaction cannot be posted" };
  if (input.allocations.length === 0) return { ok: false, error: "A bank posting needs at least one allocation" };
  if (input.allocations.some((a) => !Number.isInteger(a.cents) || a.cents < 0)) {
    return { ok: false, error: "An allocation must be a non-negative whole number of cents" };
  }
  const allocated = input.allocations.reduce((sum, a) => sum + a.cents, 0);
  if (allocated !== magnitude) {
    return { ok: false, error: `Allocations (${allocated}) do not sum to the transaction amount (${magnitude})` };
  }
  if (input.allocations.some((a) => a.accountId === input.bankLedgerAccountId)) {
    return { ok: false, error: "A transaction cannot be coded to the bank account it came from" };
  }
  if (input.allocations.some((a) => a.gstTreatment === "UNALLOCATED")) {
    return { ok: false, error: "The tax treatment is not yet decided" };
  }

  const moneyOut = input.amountCents < 0;
  const coded: BankJournalLine[] = input.allocations
    .filter((a) => a.cents > 0)
    .map((a) => {
      const debitCents = moneyOut ? a.cents : 0;
      const creditCents = moneyOut ? 0 : a.cents;
      return {
        accountId: a.accountId,
        description: a.description ?? null,
        debitCents,
        creditCents,
        // One definition of the GST a line carries, shared with the manual
        // posting path and the seed — see snapshot.ts.
        ...snapshotGst({ source: "BANK", accountTreatment: a.gstTreatment, debitCents, creditCents, gstRegistered: input.gstRegistered }),
        subcontractorId: a.subcontractorId ?? null,
        bankTransactionId: input.bankTransactionId,
      };
    });

  const lines: BankJournalLine[] = [
    ...coded,
    {
      accountId: input.bankLedgerAccountId,
      description: null,
      debitCents: moneyOut ? 0 : magnitude,
      creditCents: moneyOut ? magnitude : 0,
      gstCents: 0,
      gstTreatment: "BAS_EXCLUDED",
      subcontractorId: null,
      bankTransactionId: input.bankTransactionId,
    },
  ];

  const shape: JournalShapeError | null = checkJournalShape(lines);
  if (shape) return { ok: false, error: shape.message };

  const totals = journalTotals(lines);
  return {
    ok: true,
    lines,
    totalCents: totals.debitCents,
    gstCents: coded.reduce((sum, line) => sum + line.gstCents, 0),
  };
}

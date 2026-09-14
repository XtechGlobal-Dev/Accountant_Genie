/**
 * Journal entries as the frontend sees them, and the shape it posts back.
 *
 * Money is integer cents on both sides of the boundary. The form parses typed
 * dollars into cents with `@/shared/money` before anything is sent; the server
 * validates cents, never dollars.
 */

import type { GstTreatment, JournalSource } from "@/shared/enums";

/** One row of a client's journal list. */
export interface JournalEntryRow {
  id: string;
  date: Date;
  reference: string | null;
  description: string | null;
  source: JournalSource;
  /** Sum of debits — equal to the sum of credits. */
  totalCents: number;
  lineCount: number;
  /** This entry cancels another. */
  isReversal: boolean;
  /** Set once another entry has reversed this one. */
  reversedById: string | null;
  postedBy: string | null;
  createdAt: Date;
}

export interface JournalLineView {
  id: string;
  accountId: string;
  accountCode: number;
  accountName: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
  /** Signed from the account's natural side; see `naturalGross` on the server. */
  gstCents: number;
  gstTreatment: GstTreatment | null;
}

export interface JournalEntryDetail {
  id: string;
  date: Date;
  reference: string | null;
  description: string | null;
  source: JournalSource;
  totalCents: number;
  postedBy: string | null;
  createdAt: Date;
  /** The entry this one reverses, when it is a reversal. */
  reverses: { id: string; date: Date } | null;
  /** The entry that reversed this one, once one has. */
  reversedBy: { id: string; date: Date } | null;
  lines: JournalLineView[];
}

/* -------------------------------------------------------------------------- */
/* What the form posts                                                        */
/* -------------------------------------------------------------------------- */

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debitCents: number;
  creditCents: number;
  subcontractorId?: string;
}

export interface JournalInput {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  reference?: string;
  description?: string;
  /** OPENING must be dated 1 July and may exist once per financial year. */
  source: "MANUAL" | "OPENING";
  lines: JournalLineInput[];
}

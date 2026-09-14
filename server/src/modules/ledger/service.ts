import "server-only";

import { db, type DbClient } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type { GstTreatment } from "@/shared/enums";
import { gstFromGross, naturalGross } from "@/server/au/gst";
import { financialYearOf, financialYearRange } from "@/server/au/fy";
import * as clients from "@/server/modules/clients/repository";
import * as subcontractors from "@/server/modules/subcontractors/repository";
import type { ActionResult } from "@/shared/contracts/result";
import type { JournalEntryDetail, JournalEntryRow } from "@/shared/contracts/journal";
import * as repo from "./repository";
import type { JournalInputParsed, ReverseJournalParsed } from "./schema";
import { checkJournalShape, journalTotals } from "./validate";

/**
 * Posting to the ledger.
 *
 * Everything that reaches a journal passes through `postJournal`: the manual
 * form today, the reconciliation engine in Phase 4. The rules are the same for
 * both and live here, once — a journal balances, every account resolves for
 * this client, no line posts to a sentinel, and GST is computed by the
 * deterministic engine from the account's treatment, never taken from input.
 *
 * Posted entries are immutable. `reverseJournal` is the only correction path.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listJournals(
  firmId: string,
  clientId: string,
): Promise<JournalEntryRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;

  const rows = await repo.listEntries(firmId, client.id);
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    reference: row.reference,
    description: row.description,
    source: row.source,
    totalCents: row.totalCents,
    lineCount: row._count.lines,
    isReversal: row.reversesId !== null,
    reversedById: row.reversedBy?.id ?? null,
    postedBy: row.postedBy?.name ?? null,
    createdAt: row.createdAt,
  }));
}

export async function getJournal(
  firmId: string,
  clientId: string,
  entryId: string,
): Promise<JournalEntryDetail | null> {
  const row = await repo.findEntry(firmId, clientId, entryId);
  if (!row) return null;

  return {
    id: row.id,
    date: row.date,
    reference: row.reference,
    description: row.description,
    source: row.source,
    totalCents: row.totalCents,
    postedBy: row.postedBy?.name ?? null,
    createdAt: row.createdAt,
    reverses: row.reverses,
    reversedBy: row.reversedBy,
    lines: row.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      description: line.description,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      gstCents: line.gstCents,
      gstTreatment: line.gstTreatment,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Posting                                                                    */
/* -------------------------------------------------------------------------- */

/** An opening balance is a real journal dated 1 July. */
function isFinancialYearStart(date: Date): boolean {
  return date.getUTCMonth() === 6 && date.getUTCDate() === 1;
}

export async function postJournal(
  firmId: string,
  userId: string,
  clientId: string,
  input: JournalInputParsed,
): Promise<ActionResult> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };

  // The schema has checked this already. Checking again costs nothing and
  // means no caller — a script, a job — can reach the ledger around it.
  const shape = checkJournalShape(input.lines);
  if (shape) return { ok: false, error: shape.message, field: "lines" };

  if (input.source === "OPENING") {
    if (!isFinancialYearStart(input.date)) {
      return { ok: false, error: "Opening balances are dated 1 July", field: "date" };
    }
    const fy = financialYearRange(financialYearOf(input.date));
    const existing = await repo.findOpeningEntry(firmId, client.id, fy.start, fy.end);
    if (existing) {
      return {
        ok: false,
        error: `${fy.label} already has an opening balance journal. Reverse it before posting another.`,
        field: "date",
      };
    }
  }

  // Every account must resolve for this client. One that does not is either
  // another tenant's, another client's, or does not exist — all the same case.
  const ids = [...new Set(input.lines.map((line) => line.accountId))];
  const accounts = new Map(
    (await repo.resolveAccounts(firmId, client.id, ids)).map((a) => [a.id, a]),
  );
  for (const [index, line] of input.lines.entries()) {
    const account = accounts.get(line.accountId);
    if (!account) {
      return { ok: false, error: `Line ${index + 1}: account not found`, field: `lines.${index}` };
    }
    if (!account.isActive) {
      return {
        ok: false,
        error: `Line ${index + 1}: ${account.name} is deactivated`,
        field: `lines.${index}`,
      };
    }
    if (account.type === "UNKNOWN") {
      return {
        ok: false,
        error: `Line ${index + 1}: choose a real account — ${account.name} is a holding account for the review queue`,
        field: `lines.${index}`,
      };
    }
  }

  // GST is a deterministic function of the account's treatment and the
  // client's registration. An unregistered client claims nothing and charges
  // nothing, so every line is whole. Never read from the request.
  // A subcontractor named on a line must be this client's own.
  const subIds = [...new Set(input.lines.map((l) => l.subcontractorId).filter((id): id is string => !!id))];
  if (subIds.length > 0) {
    const known = new Set((await subcontractors.listOptions(firmId, client.id)).map((s) => s.id));
    const missing = subIds.find((id) => !known.has(id));
    if (missing) return { ok: false, error: "Subcontractor not found", field: "lines" };
  }

  const lines = input.lines.map((line) => {
    const account = accounts.get(line.accountId)!;
    const gross = naturalGross(account.gstTreatment, line.debitCents, line.creditCents);
    return {
      accountId: account.id,
      description: line.description || null,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      gstCents: client.gstRegistered ? gstFromGross(gross, account.gstTreatment) : 0,
      gstTreatment: account.gstTreatment,
      subcontractorId: line.subcontractorId || null,
    };
  });
  const totals = journalTotals(lines);

  const id = await db.$transaction(async (tx) => {
    const entry = await repo.createEntry(tx, {
      clientId: client.id,
      date: input.date,
      reference: input.reference || null,
      description: input.description || null,
      source: input.source,
      totalCents: totals.debitCents,
      postedById: userId,
      lines: { create: lines },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "JOURNAL_POSTED",
      entityType: "JournalEntry",
      entityId: entry.id,
      after: {
        date: input.date.toISOString(),
        source: input.source,
        reference: input.reference ?? null,
        totalCents: totals.debitCents,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
          gstCents: line.gstCents,
          gstTreatment: line.gstTreatment,
        })),
      },
    });
    return entry.id;
  });

  return { ok: true, id };
}

/* -------------------------------------------------------------------------- */
/* Posting from a reconciled bank transaction                                 */
/* -------------------------------------------------------------------------- */

export interface BankPosting {
  clientId: string;
  date: Date;
  description: string;
  reference?: string | null | undefined;
  /** The ledger account that stands for the bank account (Cash at Bank, Credit Card). */
  bankLedgerAccountId: string;
  /** The account the transaction was coded to. */
  accountId: string;
  /** Signed: negative is money out of the bank. */
  amountCents: number;
  gstTreatment: GstTreatment;
  gstRegistered: boolean;
  subcontractorId?: string | null | undefined;
  /** The bank transaction being posted, for lineage. */
  bankTransactionId: string;
}

/**
 * Post the balanced entry a reconciled, human-accepted bank transaction
 * produces: the coded account against the bank account, GST split out. Runs
 * on the caller's transaction so the transaction's status, the entry and the
 * audit row commit together or not at all.
 *
 * The AI never reaches this. Only a person's acceptance does.
 */
export async function postBankTransactionInTx(
  tx: DbClient,
  firmId: string,
  userId: string,
  posting: BankPosting,
): Promise<string> {
  const magnitude = Math.abs(posting.amountCents);
  if (magnitude === 0) throw new Error("A zero-value transaction cannot be posted");
  const moneyOut = posting.amountCents < 0;

  const codedDebit = moneyOut ? magnitude : 0;
  const codedCredit = moneyOut ? 0 : magnitude;
  const gross = naturalGross(posting.gstTreatment, codedDebit, codedCredit);
  const gstCents = posting.gstRegistered ? gstFromGross(gross, posting.gstTreatment) : 0;

  const entry = await repo.createEntry(tx, {
    clientId: posting.clientId,
    date: posting.date,
    reference: posting.reference ?? null,
    description: posting.description,
    source: "BANK",
    totalCents: magnitude,
    postedById: userId,
    lines: {
      create: [
        {
          accountId: posting.accountId,
          description: null,
          debitCents: codedDebit,
          creditCents: codedCredit,
          gstCents,
          gstTreatment: posting.gstTreatment,
          subcontractorId: posting.subcontractorId ?? null,
        },
        {
          accountId: posting.bankLedgerAccountId,
          description: null,
          debitCents: moneyOut ? 0 : magnitude,
          creditCents: moneyOut ? magnitude : 0,
          gstCents: 0,
          gstTreatment: "BAS_EXCLUDED",
        },
      ],
    },
  });

  await recordAudit(tx, {
    firmId,
    userId,
    clientId: posting.clientId,
    action: "JOURNAL_POSTED",
    entityType: "JournalEntry",
    entityId: entry.id,
    after: {
      source: "BANK",
      bankTransactionId: posting.bankTransactionId,
      date: posting.date.toISOString(),
      totalCents: magnitude,
      accountId: posting.accountId,
      gstTreatment: posting.gstTreatment,
      gstCents,
    },
  });

  return entry.id;
}

/**
 * The mirror image of a posted entry, as lines ready to create. Shared by the
 * manual reversal and by reopening an accepted bank transaction.
 */
export function reversalLines(
  lines: ReadonlyArray<{
    accountId: string;
    description: string | null;
    debitCents: number;
    creditCents: number;
    gstCents: number;
    gstTreatment: GstTreatment | null;
    subcontractorId?: string | null;
  }>,
) {
  return lines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debitCents: line.creditCents,
    creditCents: line.debitCents,
    gstCents: -line.gstCents,
    gstTreatment: line.gstTreatment,
    subcontractorId: line.subcontractorId ?? null,
  }));
}

/**
 * Cancel a posted entry by posting its mirror image. The original stays
 * exactly as it was; the reversal carries the same GST snapshot with the sign
 * flipped, so a BAS for the period nets to what it should.
 */
export async function reverseJournal(
  firmId: string,
  userId: string,
  clientId: string,
  entryId: string,
  input: ReverseJournalParsed,
): Promise<ActionResult> {
  const original = await repo.findEntry(firmId, clientId, entryId);
  if (!original) return { ok: false, error: "Journal not found" };

  if (original.reversedBy) {
    return { ok: false, error: "This journal has already been reversed" };
  }
  if (original.reverses) {
    return {
      ok: false,
      error: "This journal is itself a reversal. Post a new journal instead of reversing it.",
    };
  }
  if (input.date < original.date) {
    return {
      ok: false,
      error: "A reversal cannot be dated before the journal it reverses",
      field: "date",
    };
  }

  const lines = reversalLines(original.lines);

  const id = await db.$transaction(async (tx) => {
    const reversal = await repo.createEntry(tx, {
      clientId,
      date: input.date,
      reference: original.reference ? `REV ${original.reference}` : null,
      description: `Reversal of ${original.description ?? `journal dated ${original.date.toISOString().slice(0, 10)}`}`,
      source: "MANUAL",
      totalCents: original.totalCents,
      reversesId: original.id,
      postedById: userId,
      lines: { create: lines },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "JOURNAL_REVERSED",
      entityType: "JournalEntry",
      entityId: original.id,
      before: { reversedById: null },
      after: { reversedById: reversal.id, date: input.date.toISOString() },
    });
    return reversal.id;
  });

  return { ok: true, id };
}

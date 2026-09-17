import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * Journal entries belong to a client, and a client to a firm. Every read walks
 * that path from the session firm; every ID lifted from another tenant's URL
 * resolves to nothing.
 *
 * There is no update and no delete in this file. A posted journal is
 * immutable; the only way to change what it did is to post another one.
 * See .claude/skills/double-entry-ledger/SKILL.md.
 */

const ownedEntry = (firmId: string, clientId: string) => ({
  clientId,
  client: { firmId },
});

const LINE_SELECT = {
  id: true,
  accountId: true,
  description: true,
  debitCents: true,
  creditCents: true,
  gstCents: true,
  gstTreatment: true,
  subcontractorId: true,
  bankTransactionId: true,
  account: { select: { code: true, name: true } },
} satisfies Prisma.JournalLineSelect;

export function listEntries(firmId: string, clientId: string, take = 500) {
  return db.journalEntry.findMany({
    where: ownedEntry(firmId, clientId),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      date: true,
      reference: true,
      description: true,
      source: true,
      totalCents: true,
      reversesId: true,
      createdAt: true,
      reversedBy: { select: { id: true } },
      postedBy: { select: { name: true } },
      _count: { select: { lines: true } },
      lines: { orderBy: { id: "asc" }, select: LINE_SELECT },
    },
  });
}

export function findEntry(firmId: string, clientId: string, entryId: string) {
  return db.journalEntry.findFirst({
    where: { id: entryId, ...ownedEntry(firmId, clientId) },
    select: {
      id: true,
      date: true,
      reference: true,
      description: true,
      source: true,
      totalCents: true,
      createdAt: true,
      reverses: { select: { id: true, date: true } },
      reversedBy: { select: { id: true, date: true } },
      postedBy: { select: { name: true } },
      lines: { orderBy: { id: "asc" }, select: LINE_SELECT },
      // The bank transactions posted through this entry, for the reversal guard.
      transactions: { select: { id: true, status: true } },
    },
  });
}

/** The one OPENING entry a client may hold per financial year, if any. */
export function findOpeningEntry(firmId: string, clientId: string, start: Date, end: Date) {
  return db.journalEntry.findFirst({
    where: { ...ownedEntry(firmId, clientId), source: "OPENING", date: { gte: start, lt: end } },
    select: { id: true, date: true },
  });
}

/**
 * The accounts a set of IDs resolves to *for this client*: system accounts,
 * the firm's own, and the client's own. An ID from another firm's chart, or
 * from another client's private chart, is simply absent from the result.
 */
export function resolveAccounts(firmId: string, clientId: string, ids: readonly string[]) {
  return db.account.findMany({
    where: {
      id: { in: [...ids] },
      OR: [
        { firmId: null, clientId: null },
        { firmId, clientId: null },
        { firmId, clientId },
      ],
    },
    select: { id: true, code: true, name: true, type: true, gstTreatment: true, isActive: true },
  });
}

export function createEntry(
  tx: DbClient,
  data: Prisma.JournalEntryUncheckedCreateInput & {
    lines: { create: Prisma.JournalLineUncheckedCreateWithoutEntryInput[] };
  },
) {
  return tx.journalEntry.create({ data, select: { id: true } });
}

export function countEntries(firmId: string, clientId: string) {
  return db.journalEntry.count({ where: ownedEntry(firmId, clientId) });
}

export function countEntriesForFirm(firmId: string) {
  return db.journalEntry.count({ where: { client: { firmId } } });
}

import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * A bank account belongs to a client, and a client belongs to a firm. Every
 * query here walks that path from the session firm downward, so an ID lifted
 * from another tenant's URL resolves to nothing.
 *
 * Statement imports and bank transactions hang off a bank account, so their
 * reads live here too until the ingest and reconciliation modules own them.
 *
 * There is no delete. A bank account carries imported statements and the
 * transactions posted from them; removing one would orphan accounting history.
 * See §6 "Data" in CLAUDE.md.
 */

/** The ownership path, written once. */
const ownedByFirm = (firmId: string, clientId: string) => ({
  clientId,
  client: { firmId },
});

const SUMMARY_SELECT = {
  id: true,
  name: true,
  kind: true,
  accountMask: true,
  isCashAtBank: true,
  _count: { select: { transactions: true } },
} satisfies Prisma.BankAccountSelect;

export function listAccountSummaries(firmId: string, clientId: string) {
  return db.bankAccount.findMany({
    where: ownedByFirm(firmId, clientId),
    orderBy: { createdAt: "asc" },
    select: SUMMARY_SELECT,
  });
}

export function listAccounts(firmId: string, clientId: string) {
  return db.bankAccount.findMany({
    where: ownedByFirm(firmId, clientId),
    orderBy: [{ isCashAtBank: "desc" }, { createdAt: "asc" }],
    select: {
      ...SUMMARY_SELECT,
      source: true,
      createdAt: true,
      feedProductCategory: true,
      feedLastSyncedAt: true,
      _count: { select: { transactions: true, imports: true } },
    },
  });
}

export function findOwnedAccount(firmId: string, bankAccountId: string) {
  return db.bankAccount.findFirst({
    where: { id: bankAccountId, client: { firmId } },
    select: { id: true, clientId: true, isCashAtBank: true },
  });
}

export function countAccounts(firmId: string, clientId: string) {
  return db.bankAccount.count({ where: ownedByFirm(firmId, clientId) });
}

export function createAccount(
  tx: DbClient,
  data: Prisma.BankAccountUncheckedCreateInput,
) {
  return tx.bankAccount.create({ data, select: { id: true } });
}

export function updateAccount(
  tx: DbClient,
  bankAccountId: string,
  data: Prisma.BankAccountUncheckedUpdateInput,
) {
  return tx.bankAccount.update({ where: { id: bankAccountId }, data });
}

/**
 * Exactly one account per client is the Cash at Bank account, because the
 * balance sheet has one such line. Promoting an account demotes the previous
 * one; both writes are issued inside the caller's transaction, so a client is
 * never left with two Cash at Bank accounts or none.
 */
export async function promoteCashAtBank(
  tx: DbClient,
  clientId: string,
  bankAccountId: string,
) {
  await tx.bankAccount.updateMany({
    where: { clientId, id: { not: bankAccountId } },
    data: { isCashAtBank: false },
  });
  await tx.bankAccount.update({
    where: { id: bankAccountId },
    data: { isCashAtBank: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Transactions and imports                                                   */
/* -------------------------------------------------------------------------- */

const transactionsOf = (firmId: string, clientId: string) => ({
  bankAccount: ownedByFirm(firmId, clientId),
});

export function countTransactions(
  firmId: string,
  clientId: string,
  status?: "PENDING" | "CLASSIFIED" | "REVIEWED",
) {
  const where = transactionsOf(firmId, clientId);
  return db.bankTransaction.count({
    where: status ? { ...where, status } : where,
  });
}

/** Every transaction the firm holds — the usage figure behind the plan meter. */
export function countTransactionsForFirm(
  firmId: string,
  status?: "PENDING" | "CLASSIFIED" | "REVIEWED",
) {
  return db.bankTransaction.count({
    where: { bankAccount: { client: { firmId } }, ...(status ? { status } : {}) },
  });
}

/** Transactions per bank account and status, for the per-client work queue. */
export function countTransactionsByAccountForFirm(firmId: string) {
  return db.bankTransaction.groupBy({
    by: ["bankAccountId", "status"],
    where: { bankAccount: { client: { firmId } } },
    _count: { _all: true },
  });
}

/** Every bank account of the firm's active clients, with the client it belongs to. */
export function listAccountOwnersForFirm(firmId: string) {
  return db.bankAccount.findMany({
    where: { client: { firmId, archivedAt: null } },
    select: { id: true, clientId: true, client: { select: { businessName: true } } },
  });
}

/** Date and status of every transaction in a window, for the activity chart. */
export function listTransactionDatesForFirm(firmId: string, start: Date, end: Date) {
  return db.bankTransaction.findMany({
    where: { bankAccount: { client: { firmId } }, date: { gte: start, lt: end } },
    select: { date: true, status: true },
  });
}

/** The firm's latest imports across every client, for the home screen. */
export function listRecentImportsForFirm(firmId: string, take: number) {
  return db.statementImport.findMany({
    where: { bankAccount: { client: { firmId } } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      filename: true,
      status: true,
      rowCount: true,
      duplicateCount: true,
      createdAt: true,
      bankAccount: {
        select: { name: true, client: { select: { id: true, businessName: true } } },
      },
    },
  });
}

export function listRecentImports(firmId: string, clientId: string, take: number) {
  return db.statementImport.findMany({
    where: { bankAccount: ownedByFirm(firmId, clientId) },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      filename: true,
      status: true,
      rowCount: true,
      duplicateCount: true,
      createdAt: true,
      bankAccount: { select: { name: true } },
    },
  });
}

import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/** Statement imports and the rows they produce. Ownership walks bank account → client → firm. */

export function findOwnedBankAccount(firmId: string, bankAccountId: string) {
  return db.bankAccount.findFirst({
    where: { id: bankAccountId, client: { firmId } },
    select: {
      id: true,
      name: true,
      clientId: true,
      client: { select: { businessName: true } },
    },
  });
}

export function createImport(data: Prisma.StatementImportUncheckedCreateInput) {
  return db.statementImport.create({ data, select: { id: true } });
}

export function updateImport(importId: string, data: Prisma.StatementImportUncheckedUpdateInput) {
  return db.statementImport.update({ where: { id: importId }, data, select: { id: true } });
}

/**
 * Insert parsed rows. The unique fingerprint makes a duplicate a no-op rather
 * than an error, so re-importing an overlapping export is safe by construction.
 */
export async function insertTransactions(
  tx: DbClient,
  rows: Prisma.BankTransactionCreateManyInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await tx.bankTransaction.createMany({ data: rows, skipDuplicates: true });
  return count;
}

export function listRecentImportsForFirm(firmId: string, take: number) {
  return db.statementImport.findMany({
    where: { bankAccount: { client: { firmId } } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      filename: true,
      status: true,
      stage: true,
      rowCount: true,
      duplicateCount: true,
      error: true,
      createdAt: true,
      completedAt: true,
      bankAccount: {
        select: { name: true, client: { select: { id: true, businessName: true } } },
      },
    },
  });
}

/** Every active client with its bank accounts, for the upload dialog. */
export function listUploadTargets(firmId: string) {
  return db.client.findMany({
    where: { firmId, archivedAt: null },
    orderBy: { businessName: "asc" },
    select: {
      id: true,
      businessName: true,
      bankAccounts: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
    },
  });
}

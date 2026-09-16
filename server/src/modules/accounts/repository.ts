import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * The chart of accounts a firm can see: system accounts (`firmId` null), the
 * firm's own firm-wide accounts (`clientId` null) and the accounts it created
 * for particular clients.
 *
 * The `OR` is the ownership path — another firm's custom accounts never match.
 *
 * A treatment sign-off is a per-firm `AccountVerification` row, read alongside
 * the account. System accounts are shared by every firm, so the shared row is
 * never written to by a firm's advisor.
 */

const rowSelect = (firmId: string) =>
  ({
    id: true,
    code: true,
    name: true,
    description: true,
    type: true,
    gstTreatment: true,
    isSystem: true,
    isActive: true,
    firmId: true,
    clientId: true,
    requiresVerification: true,
    taxNote: true,
    version: true,
    client: { select: { businessName: true } },
    _count: { select: { journalLines: true } },
    verifications: {
      where: { firmId },
      take: 1,
      select: { verifiedAt: true, note: true, verifiedBy: { select: { name: true } } },
    },
  }) satisfies Prisma.AccountSelect;

export type AccountRow = Prisma.AccountGetPayload<{ select: ReturnType<typeof rowSelect> }>;

/** Everything the firm can see. With a client, only what applies to that client. */
export function listAccounts(firmId: string, clientId?: string) {
  return db.account.findMany({
    where: {
      OR: [
        { firmId: null, clientId: null },
        { firmId, clientId: null },
        clientId ? { firmId, clientId } : { firmId, clientId: { not: null } },
      ],
    },
    orderBy: [{ code: "asc" }, { createdAt: "asc" }],
    select: rowSelect(firmId),
  });
}

/** Active, postable accounts visible to one client, for pickers. */
export function listPostableAccounts(firmId: string, clientId: string) {
  return db.account.findMany({
    where: {
      isActive: true,
      type: { not: "UNKNOWN" },
      OR: [
        { firmId: null, clientId: null },
        { firmId, clientId: null },
        { firmId, clientId },
      ],
    },
    orderBy: { code: "asc" },
    // description is carried for the reconciliation engine, which shows it to
    // the classifier to separate similarly named accounts. Pickers map the
    // fields they render explicitly, so it does not leak into their contract.
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      gstTreatment: true,
      description: true,
    },
  });
}

/**
 * The accounts a set of IDs resolves to *for this client*: system accounts,
 * the firm's own, and the client's own. An ID from another firm, or another
 * client's private chart, is simply absent.
 */
export function resolveForClient(firmId: string, clientId: string, ids: readonly string[]) {
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

/** Accounts every client of the firm can see: system plus firm-wide. */
export function resolveForFirm(firmId: string, ids: readonly string[]) {
  return db.account.findMany({
    where: {
      id: { in: [...ids] },
      OR: [
        { firmId: null, clientId: null },
        { firmId, clientId: null },
      ],
    },
    select: { id: true, code: true, name: true, type: true, gstTreatment: true, isActive: true },
  });
}

/** A custom account this firm owns. System accounts are never returned. */
export function findOwnedCustomAccount(firmId: string, accountId: string) {
  return db.account.findFirst({
    where: { id: accountId, firmId, isSystem: false },
    select: rowSelect(firmId),
  });
}

/**
 * Whether the firm already uses a code. Custom codes must be unique across the
 * whole firm, not just within one client, so a report that lists accounts by
 * code never shows two different accounts under one number.
 *
 * Needed because `@@unique([code, firmId, clientId])` cannot enforce this:
 * Postgres treats NULL `clientId` values as distinct.
 */
export function findCodeClash(firmId: string, code: number, exceptAccountId?: string) {
  return db.account.findFirst({
    where: { firmId, code, ...(exceptAccountId ? { id: { not: exceptAccountId } } : {}) },
    select: { id: true, name: true },
  });
}

/** Any account the firm can see, system ones included — for verification. Read only. */
export function findVisibleAccount(firmId: string, accountId: string) {
  return db.account.findFirst({
    where: {
      id: accountId,
      OR: [{ firmId: null, clientId: null }, { firmId }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      gstTreatment: true,
      requiresVerification: true,
      taxNote: true,
      clientId: true,
      verifications: { where: { firmId }, take: 1, select: { id: true, verifiedAt: true } },
    },
  });
}

/** Record this firm's sign-off of an account's treatment. One row per firm and account. */
export function upsertVerification(
  tx: DbClient,
  data: { firmId: string; accountId: string; verifiedById: string; note: string | null },
) {
  return tx.accountVerification.upsert({
    where: { firmId_accountId: { firmId: data.firmId, accountId: data.accountId } },
    create: data,
    update: { verifiedById: data.verifiedById, verifiedAt: new Date(), note: data.note },
    select: { id: true },
  });
}

export function createAccount(tx: DbClient, data: Prisma.AccountUncheckedCreateInput) {
  return tx.account.create({ data, select: { id: true } });
}

/**
 * Update a custom account the firm owns. The firm is in the `where`, so a
 * shared system account — or another firm's — matches nothing. Optimistic:
 * when `expectedVersion` is given the write applies only if nobody else has
 * edited the row since it was read; the caller treats zero rows as a conflict.
 */
export async function updateOwnedAccount(
  tx: DbClient,
  firmId: string,
  accountId: string,
  data: Prisma.AccountUncheckedUpdateInput,
  expectedVersion?: number,
): Promise<number> {
  const { count } = await tx.account.updateMany({
    where: { id: accountId, firmId, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
    data: { ...data, version: { increment: 1 } },
  });
  return count;
}

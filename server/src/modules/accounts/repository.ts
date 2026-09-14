import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * The chart of accounts a firm can see: system accounts (`firmId` null), the
 * firm's own firm-wide accounts (`clientId` null) and the accounts it created
 * for particular clients.
 *
 * The `OR` is the ownership path — another firm's custom accounts never match.
 */

const ROW_SELECT = {
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
  client: { select: { businessName: true } },
  _count: { select: { journalLines: true } },
} satisfies Prisma.AccountSelect;

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
    select: ROW_SELECT,
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
    select: ROW_SELECT,
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

/** Any account the firm can see, system ones included — for verification. */
export function findVisibleAccount(firmId: string, accountId: string) {
  return db.account.findFirst({
    where: {
      id: accountId,
      OR: [{ firmId: null, clientId: null }, { firmId }],
    },
    select: { id: true, code: true, name: true, gstTreatment: true, requiresVerification: true, taxNote: true, clientId: true },
  });
}

export function createAccount(tx: DbClient, data: Prisma.AccountUncheckedCreateInput) {
  return tx.account.create({ data, select: { id: true } });
}

export function updateAccount(
  tx: DbClient,
  accountId: string,
  data: Prisma.AccountUncheckedUpdateInput,
) {
  return tx.account.update({ where: { id: accountId }, data, select: { id: true } });
}

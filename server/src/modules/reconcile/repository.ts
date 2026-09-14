import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * Bank transactions and Coding Memory.
 *
 * A transaction belongs to a bank account, which belongs to a client, which
 * belongs to a firm — every read walks that path. A memory rule carries the
 * firm ID directly.
 */

const owned = (firmId: string, clientId: string) => ({
  bankAccount: { clientId, client: { firmId } },
});

export const TX_SELECT = {
  id: true,
  date: true,
  description: true,
  normalised: true,
  amountCents: true,
  balanceCents: true,
  status: true,
  needsReview: true,
  risk: true,
  source: true,
  confidence: true,
  reasoning: true,
  accountId: true,
  gstTreatment: true,
  gstCents: true,
  netCents: true,
  bankAccountId: true,
  importId: true,
  journalEntryId: true,
  excludedAt: true,
  excludeReason: true,
  memoryRuleId: true,
  subcontractorId: true,
  account: { select: { code: true, name: true, type: true, isActive: true } },
  bankAccount: { select: { name: true, kind: true, clientId: true } },
} satisfies Prisma.BankTransactionSelect;

export function listTransactions(
  firmId: string,
  clientId: string,
  take = 5000,
  range?: { start: Date; end: Date },
) {
  return db.bankTransaction.findMany({
    where: {
      ...owned(firmId, clientId),
      ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
    },
    orderBy: range ? [{ date: "asc" }, { createdAt: "asc" }] : [{ date: "desc" }, { createdAt: "desc" }],
    take,
    select: TX_SELECT,
  });
}

/** What the engine works on: parsed rows not yet excluded, optionally a subset. */
export function listForEngine(firmId: string, clientId: string, ids?: readonly string[]) {
  return db.bankTransaction.findMany({
    where: {
      ...owned(firmId, clientId),
      excludedAt: null,
      ...(ids ? { id: { in: [...ids] } } : { status: "PENDING" }),
      // Never re-code what a person has already signed off.
      status: ids ? { not: "REVIEWED" } : "PENDING",
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      description: true,
      normalised: true,
      amountCents: true,
      // Evidence for the AI tier only. The memory and rules tiers match on the
      // normalised description and never see these.
      feedCategory: true,
      feedSubcategory: true,
    },
  });
}

export function findOwnedTransaction(firmId: string, transactionId: string) {
  return db.bankTransaction.findFirst({
    where: { id: transactionId, bankAccount: { client: { firmId } } },
    select: {
      ...TX_SELECT,
      bankAccount: {
        select: {
          name: true,
          kind: true,
          clientId: true,
          client: { select: { gstRegistered: true } },
        },
      },
      journalEntry: {
        select: {
          id: true,
          date: true,
          reversedBy: { select: { id: true } },
          lines: {
            select: {
              accountId: true,
              description: true,
              debitCents: true,
              creditCents: true,
              gstCents: true,
              gstTreatment: true,
              subcontractorId: true,
            },
          },
        },
      },
    },
  });
}

export function findOwnedTransactions(firmId: string, ids: readonly string[]) {
  return db.bankTransaction.findMany({
    where: { id: { in: [...ids] }, bankAccount: { client: { firmId } } },
    select: {
      ...TX_SELECT,
      bankAccount: {
        select: {
          name: true,
          kind: true,
          clientId: true,
          client: { select: { gstRegistered: true } },
        },
      },
    },
  });
}

export function updateTransaction(
  tx: DbClient,
  transactionId: string,
  data: Prisma.BankTransactionUncheckedUpdateInput,
) {
  return tx.bankTransaction.update({ where: { id: transactionId }, data, select: { id: true } });
}

export async function summary(firmId: string, clientId: string) {
  const where = owned(firmId, clientId);
  const [total, notCoded, needsReview, coded, reviewed, excluded] = await Promise.all([
    db.bankTransaction.count({ where }),
    db.bankTransaction.count({ where: { ...where, excludedAt: null, status: "PENDING" } }),
    db.bankTransaction.count({
      where: { ...where, excludedAt: null, status: "CLASSIFIED", needsReview: true },
    }),
    db.bankTransaction.count({
      where: { ...where, excludedAt: null, status: "CLASSIFIED", needsReview: false },
    }),
    db.bankTransaction.count({ where: { ...where, excludedAt: null, status: "REVIEWED" } }),
    db.bankTransaction.count({ where: { ...where, excludedAt: { not: null } } }),
  ]);
  return { total, notCoded, needsReview, coded, reviewed, excluded };
}

/** Descriptions a person has already signed off for this client — the opposite of novel. */
export async function reviewedDescriptions(firmId: string, clientId: string): Promise<Set<string>> {
  const rows = await db.bankTransaction.findMany({
    where: { ...owned(firmId, clientId), status: "REVIEWED" },
    distinct: ["normalised"],
    select: { normalised: true },
  });
  return new Set(rows.map((row) => row.normalised));
}

/** The system ledger account a bank account posts against (Cash at Bank, Credit Card). */
export function findSystemAccountByCode(code: number) {
  return db.account.findFirst({
    where: { code, firmId: null, clientId: null },
    select: { id: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Coding Memory                                                              */
/* -------------------------------------------------------------------------- */

const MEMORY_SELECT = {
  id: true,
  pattern: true,
  matchType: true,
  clientId: true,
  accountId: true,
  gstTreatment: true,
  hitCount: true,
  evidenceCount: true,
  lastUsedAt: true,
  createdAt: true,
  client: { select: { businessName: true } },
  account: { select: { code: true, name: true, type: true, isActive: true } },
} satisfies Prisma.MemoryRuleSelect;

/** Rules that apply to one client: its own plus the firm-wide ones. */
export function listMemoryForClient(firmId: string, clientId: string) {
  return db.memoryRule.findMany({
    where: { firmId, OR: [{ clientId: null }, { clientId }] },
    select: MEMORY_SELECT,
  });
}

/** For the memory pages: one client's rules, or every rule the firm holds. */
export function listMemoryRows(firmId: string, clientId?: string) {
  return db.memoryRule.findMany({
    where: clientId ? { firmId, clientId } : { firmId },
    orderBy: [{ clientId: "asc" }, { pattern: "asc" }],
    select: MEMORY_SELECT,
  });
}

export function findOwnedMemoryRule(firmId: string, ruleId: string) {
  return db.memoryRule.findFirst({ where: { id: ruleId, firmId }, select: MEMORY_SELECT });
}

export function upsertMemoryRule(
  tx: DbClient,
  data: {
    firmId: string;
    clientId: string | null;
    pattern: string;
    matchType: "EXACT" | "CONTAINS";
    accountId: string;
    gstTreatment: Prisma.MemoryRuleUncheckedCreateInput["gstTreatment"];
    createdById: string;
  },
) {
  return tx.memoryRule.upsert({
    where: {
      firmId_clientId_pattern: {
        firmId: data.firmId,
        // Prisma's compound unique needs a value; null matches null here.
        clientId: data.clientId as string,
        pattern: data.pattern,
      },
    },
    create: data,
    update: {
      matchType: data.matchType,
      accountId: data.accountId,
      gstTreatment: data.gstTreatment,
      evidenceCount: { increment: 1 },
    },
    select: { id: true },
  });
}

/**
 * Firm-wide rules have a null clientId, which a compound-unique upsert cannot
 * address. Look one up explicitly and create or update by ID instead.
 */
export function findMemoryRuleByPattern(firmId: string, clientId: string | null, pattern: string) {
  return db.memoryRule.findFirst({
    where: { firmId, clientId, pattern },
    select: { id: true },
  });
}

export function createMemoryRule(tx: DbClient, data: Prisma.MemoryRuleUncheckedCreateInput) {
  return tx.memoryRule.create({ data, select: { id: true } });
}

export function updateMemoryRule(
  tx: DbClient,
  ruleId: string,
  data: Prisma.MemoryRuleUncheckedUpdateInput,
) {
  return tx.memoryRule.update({ where: { id: ruleId }, data, select: { id: true } });
}

export function deleteMemoryRule(tx: DbClient, ruleId: string) {
  return tx.memoryRule.delete({ where: { id: ruleId }, select: { id: true } });
}

export async function touchMemoryRules(tx: DbClient, ruleIds: readonly string[]) {
  if (ruleIds.length === 0) return;
  await tx.memoryRule.updateMany({
    where: { id: { in: [...ruleIds] } },
    data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

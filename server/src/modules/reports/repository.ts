import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * The reporting layer reads journal lines and nothing else.
 *
 * Ownership walks entry → client → firm, so a client ID from another tenant
 * yields an empty report rather than someone else's figures. Ranges are
 * half-open `[start, end)` in UTC, matching `server/au/fy.ts`.
 */

const LINE_SELECT = {
  accountId: true,
  description: true,
  debitCents: true,
  creditCents: true,
  gstCents: true,
  gstTreatment: true,
  account: { select: { code: true, name: true, type: true } },
  entry: { select: { id: true, date: true, reference: true, description: true, source: true } },
} satisfies Prisma.JournalLineSelect;

/** Every line before `end` — for as-at statements and brought-forward balances. */
export function listLinesUntil(firmId: string, clientId: string, end: Date) {
  return db.journalLine.findMany({
    where: { entry: { clientId, client: { firmId }, date: { lt: end } } },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: LINE_SELECT,
  });
}

/** Lines on the accounts a TPAR reports, with the subcontractor each was linked to. */
export function listTparLines(firmId: string, clientId: string, start: Date, end: Date, codes: readonly number[]) {
  return db.journalLine.findMany({
    where: {
      entry: { clientId, client: { firmId }, date: { gte: start, lt: end } },
      account: { code: { in: [...codes] } },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: {
      debitCents: true,
      creditCents: true,
      gstCents: true,
      subcontractorId: true,
      subcontractor: { select: { name: true, abn: true } },
      entry: { select: { id: true, date: true } },
    },
  });
}

export function listLinesInPeriod(firmId: string, clientId: string, start: Date, end: Date) {
  return db.journalLine.findMany({
    where: {
      entry: { clientId, client: { firmId }, date: { gte: start, lt: end } },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: LINE_SELECT,
  });
}

/** The ledger accounts that stand for a bank account, by code — left out of the transactions report. */
export function listBankLedgerCodes() {
  return db.account.findMany({
    where: { firmId: null, clientId: null, OR: [{ isCashAtBank: true }, { code: { in: [701, 804] } }] },
    select: { code: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Prepared BAS statements                                                    */
/* -------------------------------------------------------------------------- */

const STATEMENT_SELECT = {
  id: true,
  clientId: true,
  periodStart: true,
  periodEnd: true,
  periodLabel: true,
  fy: true,
  quarter: true,
  month: true,
  status: true,
  gstRegistered: true,
  mappingVerified: true,
  taxRuleVersions: true,
  lineCount: true,
  unresolvedCount: true,
  finalisedAt: true,
  version: true,
  createdAt: true,
  preparedBy: { select: { name: true } },
  finalisedBy: { select: { name: true } },
  lines: {
    orderBy: { label: "asc" as const },
    select: { label: true, calculatedCents: true, adjustmentCents: true, finalCents: true, note: true },
  },
} satisfies Prisma.BasStatementSelect;

export type StatementRow = Prisma.BasStatementGetPayload<{ select: typeof STATEMENT_SELECT }>;

export function listStatements(firmId: string, clientId: string) {
  return db.basStatement.findMany({
    where: { clientId, client: { firmId } },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    select: STATEMENT_SELECT,
  });
}

export function findOwnedStatement(firmId: string, clientId: string, statementId: string) {
  return db.basStatement.findFirst({
    where: { id: statementId, clientId, client: { firmId } },
    select: STATEMENT_SELECT,
  });
}

export function createStatement(
  tx: DbClient,
  data: Prisma.BasStatementUncheckedCreateInput & { lines: { create: Prisma.BasStatementLineUncheckedCreateWithoutStatementInput[] } },
) {
  return tx.basStatement.create({ data, select: { id: true } });
}

/** Adjust one label on a DRAFT statement the firm owns. Optimistic on the statement version. */
export async function adjustStatementLine(
  tx: DbClient,
  firmId: string,
  statementId: string,
  expectedVersion: number,
  label: string,
  adjustmentCents: number,
  finalCents: number,
  note: string | null,
): Promise<number> {
  const { count } = await tx.basStatement.updateMany({
    where: { id: statementId, client: { firmId }, status: "DRAFT", version: expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (count === 0) return 0;
  await tx.basStatementLine.updateMany({
    where: { statementId, label },
    data: { adjustmentCents, finalCents, note },
  });
  return count;
}

export async function finaliseStatement(tx: DbClient, firmId: string, statementId: string, userId: string, expectedVersion: number): Promise<number> {
  const { count } = await tx.basStatement.updateMany({
    where: { id: statementId, client: { firmId }, status: "DRAFT", version: expectedVersion },
    data: { status: "FINAL", finalisedById: userId, finalisedAt: new Date(), version: { increment: 1 } },
  });
  return count;
}

import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import * as accounts from "@/server/modules/accounts/repository";
import * as clients from "@/server/modules/clients/repository";
import type { ActionResult } from "@/shared/contracts/result";
import type { LoanRow, LoanSchedule } from "@/shared/contracts/register";
import { loanSchedule } from "./amortisation";
import * as repo from "./repository";
import type { LoanInput } from "./schema";

/** The loan register — the prerequisite for splitting repayments and for the EOFY statement. */

type Row = Awaited<ReturnType<typeof repo.list>>[number];

async function accountNames(firmId: string, rows: readonly Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.accountId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const found = await accounts.resolveForFirm(firmId, ids);
  return new Map(found.map((a) => [a.id, `${a.code} · ${a.name}`]));
}

function toRow(row: Row, names: Map<string, string>): LoanRow {
  return {
    id: row.id,
    type: row.type,
    lender: row.lender,
    description: row.description,
    principalCents: row.principalCents,
    interestRateBasisPoints: row.interestRateBasisPoints,
    startDate: row.startDate,
    termMonths: row.termMonths,
    repaymentCents: row.repaymentCents,
    frequency: row.frequency,
    status: row.status,
    accountId: row.accountId,
    accountName: row.accountId ? (names.get(row.accountId) ?? null) : null,
    createdAt: row.createdAt,
  };
}

export async function listLoans(firmId: string, clientId: string): Promise<LoanRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const rows = await repo.list(firmId, client.id);
  const names = await accountNames(firmId, rows);
  return rows.map((row) => toRow(row, names));
}

export async function getLoan(
  firmId: string,
  clientId: string,
  loanId: string,
  asAt = new Date(),
): Promise<{ loan: LoanRow; schedule: LoanSchedule } | null> {
  const row = await repo.findOwned(firmId, loanId);
  if (!row || row.clientId !== clientId) return null;
  const names = await accountNames(firmId, [row]);
  return { loan: toRow(row, names), schedule: loanSchedule(row, asAt) };
}

/** Every active loan's balance as at a date — for the EOFY statement. */
export async function loanBalances(
  firmId: string,
  clientId: string,
  asAt: Date,
): Promise<{ loan: LoanRow; balanceCents: number; interestYearCents: number }[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const rows = await repo.list(firmId, client.id);
  const names = await accountNames(firmId, rows);
  const yearStart = new Date(Date.UTC(asAt.getUTCFullYear() - 1, asAt.getUTCMonth(), asAt.getUTCDate()));
  return rows
    .filter((row) => row.status === "ACTIVE")
    .map((row) => {
      const schedule = loanSchedule(row, asAt);
      const interestYearCents = schedule.rows
        .filter((r) => r.date > yearStart && r.date <= asAt)
        .reduce((s, r) => s + r.interestCents, 0);
      return { loan: toRow(row, names), balanceCents: schedule.balanceAtCents, interestYearCents };
    });
}

async function resolveAccount(
  firmId: string,
  clientId: string,
  accountId: string | undefined,
): Promise<{ accountId: string | null } | { error: ActionResult }> {
  if (!accountId) return { accountId: null };
  const [account] = await accounts.resolveForClient(firmId, clientId, [accountId]);
  if (!account || account.type !== "LIABILITY") {
    return { error: { ok: false, error: "Choose a liability account", field: "accountId" } };
  }
  return { accountId: account.id };
}

export async function createLoan(
  firmId: string,
  userId: string,
  clientId: string,
  input: LoanInput,
): Promise<ActionResult> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };
  const scope = await resolveAccount(firmId, client.id, input.accountId);
  if ("error" in scope) return scope.error;

  const id = await db.$transaction(async (tx) => {
    const created = await repo.create(tx, {
      clientId: client.id,
      type: input.type,
      lender: input.lender,
      description: input.description || null,
      principalCents: input.principalCents,
      interestRateBasisPoints: input.interestRateBasisPoints,
      startDate: input.startDate,
      termMonths: input.termMonths,
      repaymentCents: input.repaymentCents,
      frequency: input.frequency,
      accountId: scope.accountId,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "LOAN_CREATED",
      entityType: "Loan",
      entityId: created.id,
      after: { lender: input.lender, principalCents: input.principalCents, interestRateBasisPoints: input.interestRateBasisPoints, termMonths: input.termMonths },
    });
    return created.id;
  });
  return { ok: true, id };
}

export async function updateLoan(
  firmId: string,
  userId: string,
  loanId: string,
  input: LoanInput,
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, loanId);
  if (!existing) return { ok: false, error: "Loan not found" };
  const scope = await resolveAccount(firmId, existing.clientId, input.accountId);
  if ("error" in scope) return scope.error;

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, {
      type: input.type,
      lender: input.lender,
      description: input.description || null,
      principalCents: input.principalCents,
      interestRateBasisPoints: input.interestRateBasisPoints,
      startDate: input.startDate,
      termMonths: input.termMonths,
      repaymentCents: input.repaymentCents,
      frequency: input.frequency,
      accountId: scope.accountId,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "LOAN_UPDATED",
      entityType: "Loan",
      entityId: existing.id,
      before: { lender: existing.lender, principalCents: existing.principalCents, interestRateBasisPoints: existing.interestRateBasisPoints, termMonths: existing.termMonths, repaymentCents: existing.repaymentCents },
      after: { lender: input.lender, principalCents: input.principalCents, interestRateBasisPoints: input.interestRateBasisPoints, termMonths: input.termMonths, repaymentCents: input.repaymentCents },
    });
  });
  return { ok: true, id: existing.id };
}

export async function setLoanStatus(
  firmId: string,
  userId: string,
  loanId: string,
  status: "ACTIVE" | "CLOSED",
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, loanId);
  if (!existing) return { ok: false, error: "Loan not found" };
  if (existing.status === status) return { ok: true, id: existing.id };

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, { status });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "LOAN_CLOSED",
      entityType: "Loan",
      entityId: existing.id,
      before: { status: existing.status },
      after: { status },
    });
  });
  return { ok: true, id: existing.id };
}

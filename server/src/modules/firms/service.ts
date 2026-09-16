import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type { Workspace } from "@/shared/contracts/workspace";
import type { DashboardView } from "@/shared/contracts/dashboard";
import type { SettingsView } from "@/shared/contracts/settings";
import type { ActionResult } from "@/shared/contracts/result";
import type { AuditRow } from "@/shared/contracts/settings";
import { planAllowance, usedThisPlanYear } from "@/server/modules/billing/service";
import { planByCode } from "@/server/modules/billing/plans";
import { currentFinancialYear, financialYearRange } from "@/server/au/fy";
import type { ClientQueueRow, MonthlyActivity } from "@/shared/contracts/dashboard";
import * as banking from "@/server/modules/banking/repository";
import * as clients from "@/server/modules/clients/repository";
import * as ledger from "@/server/modules/ledger/repository";
import * as repo from "./repository";
import type { UpdateFirmInput, UpdateProfileInput } from "./schema";


/**
 * Everything the signed-in frame needs, in one call.
 *
 * Loaded once in the app layout rather than per page, so moving between
 * sections never refetches the chrome.
 */
export async function getWorkspace(
  firmId: string,
  userName: string,
): Promise<Workspace> {
  const [firm, clientList, used, allowance, attention] = await Promise.all([
    repo.findFirmName(firmId),
    clients.listClientOptions(firmId),
    usedThisPlanYear(firmId),
    planAllowance(firmId),
    banking.countTransactionsForFirm(firmId, "CLASSIFIED"),
  ]);
  const plan = planByCode(firm?.planCode ?? "TRIAL");

  return {
    user: { name: userName },
    firmName: firm?.name ?? "Accountant Genie",
    clients: clientList,
    quota: { total: allowance, used },
    plan: { code: plan.code, name: plan.name, isTrial: plan.code === "TRIAL" },
    attention,
  };
}

/** Where each active client's transactions stand. Sorted by most waiting first. */
export async function getFirmQueue(firmId: string): Promise<ClientQueueRow[]> {
  const [owners, counts] = await Promise.all([
    banking.listAccountOwnersForFirm(firmId),
    banking.countTransactionsByAccountForFirm(firmId),
  ]);
  const byAccount = new Map(owners.map((o) => [o.id, o]));
  const rows = new Map<string, ClientQueueRow>();
  for (const owner of owners) {
    if (!rows.has(owner.clientId)) {
      rows.set(owner.clientId, { clientId: owner.clientId, name: owner.client.businessName, notCoded: 0, awaitingReview: 0, reviewed: 0 });
    }
  }
  for (const group of counts) {
    const owner = byAccount.get(group.bankAccountId);
    if (!owner) continue;
    const row = rows.get(owner.clientId);
    if (!row) continue;
    const n = group._count._all;
    if (group.status === "PENDING") row.notCoded += n;
    else if (group.status === "CLASSIFIED") row.awaitingReview += n;
    else row.reviewed += n;
  }
  return [...rows.values()].sort(
    (a, b) => b.awaitingReview + b.notCoded - (a.awaitingReview + a.notCoded) || a.name.localeCompare(b.name),
  );
}

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

/** Transactions by month of the current financial year. */
export async function getMonthlyActivity(firmId: string, fy = currentFinancialYear()): Promise<MonthlyActivity[]> {
  const range = financialYearRange(fy);
  const rows = await banking.listTransactionDatesForFirm(firmId, range.start, range.end);
  const months = MONTHS.map((label) => ({ label, imported: 0, coded: 0, reviewed: 0 }));
  for (const row of rows) {
    // July is index 0 of the financial year.
    const index = (row.date.getUTCMonth() + 6) % 12;
    const month = months[index];
    if (!month) continue;
    month.imported += 1;
    if (row.status !== "PENDING") month.coded += 1;
    if (row.status === "REVIEWED") month.reviewed += 1;
  }
  return months;
}

/* -------------------------------------------------------------------------- */
/* Home                                                                       */
/* -------------------------------------------------------------------------- */

export async function getDashboard(firmId: string): Promise<DashboardView> {
  const [active, archived, total, awaitingReview, notCoded, journalCount, imports, queue, monthly] =
    await Promise.all([
      clients.countClients(firmId, false),
      clients.countClients(firmId, true),
      banking.countTransactionsForFirm(firmId),
      banking.countTransactionsForFirm(firmId, "CLASSIFIED"),
      banking.countTransactionsForFirm(firmId, "PENDING"),
      ledger.countEntriesForFirm(firmId),
      banking.listRecentImportsForFirm(firmId, 6),
      getFirmQueue(firmId),
      getMonthlyActivity(firmId),
    ]);

  return {
    clients: { active, archived },
    transactions: { total, awaitingReview, notCoded },
    journalCount,
    recentImports: imports.map((row) => ({
      id: row.id,
      filename: row.filename,
      bankAccountName: row.bankAccount.name,
      status: row.status,
      rowCount: row.rowCount,
      duplicateCount: row.duplicateCount,
      createdAt: row.createdAt,
      clientId: row.bankAccount.client.id,
      clientName: row.bankAccount.client.businessName,
    })),
    queue,
    monthly,
  };
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/** `null` only if the session's user or firm has vanished underneath it. */
export async function getSettings(firmId: string, userId: string): Promise<SettingsView | null> {
  const [firm, user] = await Promise.all([repo.findFirm(firmId), repo.findUser(firmId, userId)]);
  if (!firm || !user) return null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isTaxAgent: user.isTaxAgent,
      agentNumber: user.agentNumber,
      memberSince: user.createdAt,
    },
    firm: {
      id: firm.id,
      name: firm.name,
      abn: firm.abn,
      createdAt: firm.createdAt,
      userCount: firm._count.users,
      clientCount: firm._count.clients,
    },
  };
}

export async function updateFirm(
  firmId: string,
  userId: string,
  input: UpdateFirmInput,
): Promise<ActionResult> {
  const before = await repo.findFirm(firmId);
  if (!before) return { ok: false, error: "Firm not found" };

  const abn = input.abn || null;
  await db.$transaction(async (tx) => {
    await repo.updateFirm(tx, firmId, { name: input.name, abn });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "FIRM_UPDATED",
      entityType: "Firm",
      entityId: firmId,
      before: { name: before.name, abn: before.abn },
      after: { name: input.name, abn },
    });
  });

  return { ok: true, id: firmId };
}

export async function updateProfile(
  firmId: string,
  userId: string,
  input: UpdateProfileInput,
): Promise<ActionResult> {
  const before = await repo.findUser(firmId, userId);
  if (!before) return { ok: false, error: "User not found" };

  await db.$transaction(async (tx) => {
    await repo.updateUserName(tx, firmId, userId, input.name);
    await recordAudit(tx, {
      firmId,
      userId,
      action: "PROFILE_UPDATED",
      entityType: "User",
      entityId: userId,
      before: { name: before.name },
      after: { name: input.name },
    });
  });

  return { ok: true, id: userId };
}

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                */
/* -------------------------------------------------------------------------- */

export async function listAudit(firmId: string, take = 200): Promise<AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { firmId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      clientId: true,
      before: true,
      after: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((id): id is string => id !== null))];
  const names = new Map(
    clientIds.length === 0
      ? []
      : (
          await db.client.findMany({
            where: { id: { in: clientIds }, firmId },
            select: { id: true, businessName: true },
          })
        ).map((c) => [c.id, c.businessName] as const),
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    userName: row.user?.name ?? null,
    clientName: row.clientId ? (names.get(row.clientId) ?? null) : null,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  }));
}

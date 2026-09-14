import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { GST_TREATMENT_LABELS, basLabelsFor, isGstBearing } from "@/server/au/gst";
import * as clients from "@/server/modules/clients/repository";
import type { AccountType } from "@/shared/enums";
import type { ActionResult } from "@/shared/contracts/result";
import type {
  AccountOption,
  AccountScope,
  ChartAccountRow,
  ChartOfAccounts,
} from "@/shared/contracts/account";
import { ACCOUNT_TYPE_LABELS } from "@/shared/labels";
import * as repo from "./repository";
import type { CustomAccountInput } from "./schema";

/**
 * Report order. Accounts read top to bottom in this sequence everywhere they
 * are listed, so it is defined once here rather than in whichever page happens
 * to render them. Unallocated leads: it is the pile that needs attention.
 */
const TYPE_ORDER: AccountType[] = [
  "UNKNOWN",
  "INCOME",
  "COGS",
  "EXPENSE",
  "ASSET",
  "LIABILITY",
  "EQUITY",
];

type Row = Awaited<ReturnType<typeof repo.listAccounts>>[number];

function scopeOf(row: Pick<Row, "firmId" | "clientId">): AccountScope {
  if (row.firmId === null) return "SYSTEM";
  return row.clientId === null ? "FIRM" : "CLIENT";
}

function toRow(row: Row): ChartAccountRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    type: row.type,
    gstTreatment: row.gstTreatment,
    isSystem: row.isSystem,
    isActive: row.isActive,
    scope: scopeOf(row),
    clientId: row.clientId,
    clientName: row.client?.businessName ?? null,
    postingCount: row._count.journalLines,
    requiresVerification: row.requiresVerification,
    taxNote: row.taxNote,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The chart as one firm sees it. With a client, the chart that client posts
 * against: system + firm-wide + that client's own accounts.
 */
export async function getChartOfAccounts(
  firmId: string,
  clientId?: string,
): Promise<ChartOfAccounts> {
  const accounts = (await repo.listAccounts(firmId, clientId)).map(toRow);

  return {
    groups: TYPE_ORDER.map((type) => ({
      type,
      rows: accounts.filter((account) => account.type === type),
    })).filter((group) => group.rows.length > 0),
    total: accounts.length,
    customCount: accounts.filter((account) => !account.isSystem).length,
    // Tax treatments the registered advisor has not signed off. Surfaced at the
    // top of the page because coding against an unverified treatment is how a
    // wrong BAS starts. See §6 "Tax" in CLAUDE.md.
    flagged: accounts.filter((account) => account.requiresVerification),
  };
}

/**
 * Accounts a journal line for this client may post to. `null` when the firm
 * does not own the client.
 *
 * `gstBearing` is decided here, from the account's treatment and the client's
 * registration, so the form never has to know a tax rule.
 */
export async function listAccountOptions(
  firmId: string,
  clientId: string,
): Promise<AccountOption[] | null> {
  const client = await clients.findClientHeader(firmId, clientId);
  if (!client) return null;

  const rows = await repo.listPostableAccounts(firmId, client.id);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    gstTreatment: row.gstTreatment,
    gstBearing: client.gstRegistered && isGstBearing(row.gstTreatment),
  }));
}

/** Accounts every client can see — system plus firm-wide — for firm-level pickers. */
export async function listFirmAccountOptions(firmId: string): Promise<AccountOption[]> {
  const rows = await repo.listAccounts(firmId);
  return rows
    .filter((row) => row.isActive && row.type !== "UNKNOWN" && row.clientId === null)
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      gstTreatment: row.gstTreatment,
      gstBearing: isGstBearing(row.gstTreatment),
    }));
}

/** The chart as a CSV file, for the firm's own records or another system. */
export async function chartToCsv(firmId: string, clientId?: string): Promise<string> {
  const { groups } = await getChartOfAccounts(firmId, clientId);
  const header = [
    "Code",
    "Name",
    "Type",
    "Tax code",
    "BAS labels",
    "Scope",
    "Client",
    "Active",
    "Description",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const group of groups) {
    for (const row of group.rows) {
      lines.push(
        [
          String(row.code),
          row.name,
          ACCOUNT_TYPE_LABELS[row.type],
          GST_TREATMENT_LABELS[row.gstTreatment],
          basLabelsFor(row.gstTreatment).join(" "),
          row.scope === "SYSTEM" ? "System" : row.scope === "FIRM" ? "All clients" : "Client",
          row.clientName ?? "",
          row.isActive ? "Yes" : "No",
          row.description ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the client a custom account is for. Empty means firm-wide. A client
 * ID the firm does not own is reported as a form error on that field, not as
 * a distinguishable "forbidden".
 */
async function resolveScope(
  firmId: string,
  clientId: string | undefined,
): Promise<{ clientId: string | null } | { error: ActionResult }> {
  if (!clientId) return { clientId: null };
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return { error: { ok: false, error: "Client not found", field: "clientId" } };
  return { clientId: client.id };
}

export async function createCustomAccount(
  firmId: string,
  userId: string,
  input: CustomAccountInput,
): Promise<ActionResult> {
  const scope = await resolveScope(firmId, input.clientId);
  if ("error" in scope) return scope.error;

  const clash = await repo.findCodeClash(firmId, input.code);
  if (clash) {
    return {
      ok: false,
      error: `Code ${input.code} is already used by ${clash.name}`,
      field: "code",
    };
  }

  const id = await db.$transaction(async (tx) => {
    const account = await repo.createAccount(tx, {
      firmId,
      clientId: scope.clientId,
      code: input.code,
      name: input.name,
      type: input.type,
      gstTreatment: input.gstTreatment,
      description: input.description || null,
      isSystem: false,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: scope.clientId,
      action: "ACCOUNT_CREATED",
      entityType: "Account",
      entityId: account.id,
      after: {
        code: input.code,
        name: input.name,
        type: input.type,
        gstTreatment: input.gstTreatment,
        clientId: scope.clientId,
      },
    });
    return account.id;
  });

  return { ok: true, id };
}

/**
 * Edit a custom account. The code is locked once anything has been posted to
 * it — a renumbered account would silently re-sort every historical report.
 * Changing the tax treatment is allowed because posted lines carry their own
 * snapshot of the treatment they were coded under.
 */
export async function updateCustomAccount(
  firmId: string,
  userId: string,
  accountId: string,
  input: CustomAccountInput,
): Promise<ActionResult> {
  const existing = await repo.findOwnedCustomAccount(firmId, accountId);
  if (!existing) return { ok: false, error: "Account not found" };

  const scope = await resolveScope(firmId, input.clientId);
  if ("error" in scope) return scope.error;

  const hasPostings = existing._count.journalLines > 0;
  if (hasPostings && input.code !== existing.code) {
    return {
      ok: false,
      error: "The code cannot change once journal lines have been posted to this account",
      field: "code",
    };
  }
  if (hasPostings && scope.clientId !== existing.clientId) {
    return {
      ok: false,
      error: "An account with postings cannot move between clients",
      field: "clientId",
    };
  }

  const clash = await repo.findCodeClash(firmId, input.code, existing.id);
  if (clash) {
    return {
      ok: false,
      error: `Code ${input.code} is already used by ${clash.name}`,
      field: "code",
    };
  }

  await db.$transaction(async (tx) => {
    await repo.updateAccount(tx, existing.id, {
      clientId: scope.clientId,
      code: input.code,
      name: input.name,
      type: input.type,
      gstTreatment: input.gstTreatment,
      description: input.description || null,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: scope.clientId,
      action: "ACCOUNT_UPDATED",
      entityType: "Account",
      entityId: existing.id,
      before: {
        code: existing.code,
        name: existing.name,
        type: existing.type,
        gstTreatment: existing.gstTreatment,
        clientId: existing.clientId,
      },
      after: {
        code: input.code,
        name: input.name,
        type: input.type,
        gstTreatment: input.gstTreatment,
        clientId: scope.clientId,
      },
    });
  });

  return { ok: true, id: existing.id };
}

/**
 * The registered tax advisor signs off a tax treatment. Clears the flag and
 * records who, when and what the treatment was at the time. The caller has
 * already checked the person is a tax agent.
 */
export async function verifyAccountTreatment(
  firmId: string,
  userId: string,
  accountId: string,
  note: string | null,
): Promise<ActionResult> {
  const account = await repo.findVisibleAccount(firmId, accountId);
  if (!account) return { ok: false, error: "Account not found" };
  if (!account.requiresVerification) return { ok: true, id: account.id };

  await db.$transaction(async (tx) => {
    await repo.updateAccount(tx, account.id, {
      requiresVerification: false,
      taxNote: note ? `Verified: ${note}` : `Verified — ${account.taxNote ?? "treatment confirmed"}`,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: account.clientId,
      action: "ACCOUNT_VERIFIED",
      entityType: "Account",
      entityId: account.id,
      before: { gstTreatment: account.gstTreatment, taxNote: account.taxNote },
      after: { gstTreatment: account.gstTreatment, note },
    });
  });
  return { ok: true, id: account.id };
}

/**
 * Accounts are deactivated, never deleted. A deactivated account keeps every
 * line ever posted to it and simply stops being offered for new coding.
 */
export async function setCustomAccountActive(
  firmId: string,
  userId: string,
  accountId: string,
  active: boolean,
): Promise<ActionResult> {
  const existing = await repo.findOwnedCustomAccount(firmId, accountId);
  if (!existing) return { ok: false, error: "Account not found" };
  if (existing.isActive === active) return { ok: true, id: existing.id };

  await db.$transaction(async (tx) => {
    await repo.updateAccount(tx, existing.id, { isActive: active });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: active ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED",
      entityType: "Account",
      entityId: existing.id,
      before: { isActive: existing.isActive },
      after: { isActive: active },
    });
  });

  return { ok: true, id: existing.id };
}

import "server-only";

import { db, type DbClient } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { GST_TREATMENT_LABELS, basLabelsFor, isGstBearing } from "@/server/au/gst";
import * as clients from "@/server/modules/clients/repository";
import type { AccountType } from "@/shared/enums";
import { CREATABLE_ACCOUNT_TYPES, treatmentAllowedFor } from "@/shared/account-rules";
import { findSimilarAccount, nextCustomCode, type AccountProposal, type ResolvableAccount } from "./resolver";
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

type Row = repo.AccountRow;

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
    // The seed's flag, cleared FOR THIS FIRM by its own advisor's sign-off.
    // The shared row is never written, so no firm can clear it for another.
    requiresVerification: row.requiresVerification && row.verifications.length === 0,
    taxNote: row.taxNote,
    verifiedBy: row.verifications[0]?.verifiedBy?.name ?? null,
    verifiedAt: row.verifications[0]?.verifiedAt ?? null,
    version: row.version,
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

  // Optimistic: the write carries the version the form was opened with. Zero
  // rows means a colleague saved first, and their edit is kept, not merged over.
  const conflict = await db.$transaction(async (tx) => {
    const written = await repo.updateOwnedAccount(
      tx,
      firmId,
      existing.id,
      {
        clientId: scope.clientId,
        code: input.code,
        name: input.name,
        type: input.type,
        gstTreatment: input.gstTreatment,
        description: input.description || null,
      },
      input.version,
    );
    if (written === 0) return true;
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
    return false;
  });
  if (conflict) {
    return { ok: false, error: "Someone else changed this account while you were editing it. Reload and try again." };
  }

  return { ok: true, id: existing.id };
}

/**
 * The firm's registered tax advisor signs off a tax treatment — for this firm.
 *
 * The sign-off is a per-firm `AccountVerification` row. The account itself,
 * which for a system account is shared by every firm on the platform, is
 * never written: one firm's advisor clearing a flag that another firm's
 * reports then relied on was a cross-tenant write, and this is the fix. The
 * caller has already checked the person is a tax agent with `tax:verify`.
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
  if (account.verifications.length > 0) return { ok: true, id: account.id };

  await db.$transaction(async (tx) => {
    const verification = await repo.upsertVerification(tx, {
      firmId,
      accountId: account.id,
      verifiedById: userId,
      note,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: account.clientId,
      action: "ACCOUNT_VERIFIED",
      entityType: "AccountVerification",
      entityId: verification.id,
      before: { accountId: account.id, gstTreatment: account.gstTreatment, taxNote: account.taxNote },
      after: { accountId: account.id, gstTreatment: account.gstTreatment, note },
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
    await repo.updateOwnedAccount(tx, firmId, existing.id, { isActive: active });
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

/* -------------------------------------------------------------------------- */
/* Accounts proposed by the classifier                                        */
/* -------------------------------------------------------------------------- */

export interface ProposalLineage {
  /** The bank transaction whose classification proposed the account. */
  bankTransactionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  reason: string;
  confidence: number;
}

export type ProposalOutcome =
  | { ok: true; account: ResolvableAccount; created: boolean; matchedScore: number | null }
  | { ok: false; error: string };

/**
 * Turn an AI account proposal into an account id, on the caller's transaction.
 *
 * The model has said "nothing in the chart holds this supply; it is a
 * <name> of type <type> with <treatment>". This is where the backend decides
 * — the model decides nothing here:
 *
 *   1. Is the proposal well-formed? A type that cannot be created, or a
 *      treatment the type cannot carry, is refused.
 *   2. Does the chart already have it? The resolver's similarity match runs
 *      over every account the client can post to, including ones created
 *      earlier in the same run. A hit is reused, and nothing is created.
 *   3. Otherwise allocate the next free code in the type's band and create
 *      the account FIRM-WIDE, so the next client with the same kind of
 *      expense reuses it, flagged for the advisor because its treatment has
 *      not been signed off by a person.
 *
 * The audit row records the transaction, provider, model and prompt that
 * proposed it, so "where did this account come from?" has an answer.
 */
export async function resolveProposedAccountInTx(
  tx: DbClient,
  firmId: string,
  userId: string | null,
  proposal: AccountProposal,
  visible: readonly ResolvableAccount[],
  lineage: ProposalLineage,
): Promise<ProposalOutcome> {
  const name = proposal.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) return { ok: false, error: "The proposed account has no name" };
  if (!CREATABLE_ACCOUNT_TYPES.includes(proposal.type)) {
    return { ok: false, error: `${proposal.type} accounts cannot be created` };
  }
  if (proposal.gstTreatment === "UNALLOCATED" || !treatmentAllowedFor(proposal.type, proposal.gstTreatment)) {
    return { ok: false, error: `${GST_TREATMENT_LABELS[proposal.gstTreatment]} does not apply to a ${ACCOUNT_TYPE_LABELS[proposal.type].toLowerCase()} account` };
  }

  const similar = findSimilarAccount(visible, { ...proposal, name });
  if (similar) return { ok: true, account: similar.account, created: false, matchedScore: similar.score };

  // Two runs for the same firm at once — an import and a re-code, two
  // imports for two clients — would each find nothing and each create the
  // account, under different codes. Take the firm's row lock so creation is
  // serialised per firm, then look again at what is there NOW rather than
  // at the chart the caller read before its transaction began.
  await tx.$executeRaw`SELECT 1 FROM "Firm" WHERE "id" = ${firmId} FOR UPDATE`;
  const fresh = await repo.listFirmWideAccounts(tx, firmId, proposal.type);
  const nowSimilar = findSimilarAccount(fresh, { ...proposal, name });
  if (nowSimilar) return { ok: true, account: nowSimilar.account, created: false, matchedScore: nowSimilar.score };

  const code = nextCustomCode(await repo.listTakenCodes(tx, firmId), proposal.type);
  if (code === null) return { ok: false, error: `No free ${ACCOUNT_TYPE_LABELS[proposal.type].toLowerCase()} code is left in the custom range` };

  const created = await repo.createAccount(tx, {
    firmId,
    clientId: null,
    code,
    name,
    type: proposal.type,
    gstTreatment: proposal.gstTreatment,
    description: `Created from transaction classification (${lineage.reason.slice(0, 160)})`,
    isSystem: false,
    requiresVerification: true,
    taxNote:
      "CREATED FROM AN AI PROPOSAL during a statement import. The type and default tax treatment are the classifier's; nobody has confirmed them. Review the name for duplication and the treatment for correctness, then clear this flag.",
  });
  await recordAudit(tx, {
    firmId,
    userId,
    clientId: null,
    action: "ACCOUNT_CREATED",
    entityType: "Account",
    entityId: created.id,
    after: {
      code,
      name,
      type: proposal.type,
      gstTreatment: proposal.gstTreatment,
      clientId: null,
      source: "AI_PROPOSAL",
      bankTransactionId: lineage.bankTransactionId,
      provider: lineage.provider,
      model: lineage.model,
      promptVersion: lineage.promptVersion,
      confidence: lineage.confidence,
      reason: lineage.reason,
    },
  });

  return {
    ok: true,
    created: true,
    matchedScore: null,
    account: { id: created.id, code, name, type: proposal.type, gstTreatment: proposal.gstTreatment, description: null },
  };
}

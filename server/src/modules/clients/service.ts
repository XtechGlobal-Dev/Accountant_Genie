import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type {
  ClientDetail,
  ClientHeader,
  ClientNote,
  ClientOverview,
  ClientOption,
  ClientRow,
  Partner,
} from "@/shared/contracts/client";
import type { ActionResult } from "@/shared/contracts/result";
import * as banking from "@/server/modules/banking/repository";
import { countTransactionsByStatus } from "@/server/modules/banking/service";
import * as repo from "@/server/modules/clients/repository";
import * as ledger from "@/server/modules/ledger/repository";
import type {
  CreateClientInput,
  UpdateClientInput,
  ClientNoteInput,
  PartnersInput,
} from "./schema";

/**
 * Client domain operations.
 *
 * Every function takes `firmId` explicitly. The session is resolved at the
 * transport edge — an action or a page — and never read in here, which keeps
 * this module callable from a job, a script or a test, and makes it impossible
 * to write a query that silently forgot which tenant it was for.
 *
 * Services return plain data or `null`. They do not throw for a missing record
 * and they never import from `next/*`: deciding whether "not found" means a 404
 * page or a form error is the caller's job.
 */

/* -------------------------------------------------------------------------- */
/* Domain rules                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fields that belong to one entity type are cleared when the client moves to
 * another, rather than left behind as stale data a later report would pick up.
 * A unit count on a company is not merely unused — it is wrong.
 */
function entityFields(input: CreateClientInput | UpdateClientInput) {
  return {
    incomeTaxRate: input.entityType === "COMPANY" ? (input.incomeTaxRate ?? 25) : null,
    totalUnits: input.entityType === "UNIT_TRUST" ? (input.totalUnits ?? null) : null,
    unitValueCents:
      input.entityType === "UNIT_TRUST" ? (input.unitValueCents ?? null) : null,
  };
}

/** An empty optional text field is absence, not an empty string. */
const orNull = (v: string | undefined) => v || null;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listClients(
  firmId: string,
  archived: boolean,
): Promise<ClientRow[]> {
  const rows = await repo.listClients(firmId, archived);
  return rows.map((row) => ({
    id: row.id,
    businessName: row.businessName,
    abn: row.abn,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    entityType: row.entityType,
    gstRegistered: row.gstRegistered,
    basFrequency: row.basFrequency,
    bankCount: row._count.bankAccounts,
    archived: row.archivedAt !== null,
  }));
}

export function listClientOptions(firmId: string): Promise<ClientOption[]> {
  return repo.listClientOptions(firmId);
}

export async function getClientHeader(
  firmId: string,
  clientId: string,
): Promise<ClientHeader | null> {
  const row = await repo.findClientHeader(firmId, clientId);
  if (!row) return null;
  const { archivedAt, ...rest } = row;
  return { ...rest, archived: archivedAt !== null };
}

export async function getClientDetail(
  firmId: string,
  clientId: string,
): Promise<ClientDetail | null> {
  const row = await repo.findClientDetail(firmId, clientId);
  if (!row) return null;
  const { archivedAt: _archivedAt, ...detail } = row;
  return detail;
}

/**
 * The overview composes across modules: the client owns the notes, banking owns
 * the accounts, the statements and the transaction counts. Composition happens
 * here, in a service, rather than in the page — the page should not know that
 * "awaiting review" means `status = CLASSIFIED`.
 */
export async function getClientOverview(
  firmId: string,
  clientId: string,
): Promise<ClientOverview | null> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return null;

  const [bankAccounts, counts, imports, notes, journalCount] = await Promise.all([
    banking.listAccountSummaries(firmId, client.id),
    countTransactionsByStatus(firmId, client.id),
    banking.listRecentImports(firmId, client.id, 5),
    repo.listClientNotes(firmId, client.id),
    ledger.countEntries(firmId, client.id),
  ]);

  return {
    journalCount,
    bankAccounts: bankAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      accountMask: account.accountMask,
      isCashAtBank: account.isCashAtBank,
      transactionCount: account._count.transactions,
    })),
    counts,
    imports: imports.map((row) => ({
      id: row.id,
      filename: row.filename,
      bankAccountName: row.bankAccount.name,
      status: row.status,
      rowCount: row.rowCount,
      duplicateCount: row.duplicateCount,
      createdAt: row.createdAt,
    })),
    notes: notes satisfies ClientNote[],
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createClient(
  firmId: string,
  input: CreateClientInput,
): Promise<{ id: string }> {
  return repo.createClient({
    firmId,
    businessName: input.businessName,
    abn: orNull(input.abn),
    industry: orNull(input.industry),
    entityType: input.entityType,
    gstRegistered: input.gstRegistered,
    ...entityFields(input),
  });
}

/** `false` means the firm does not own a client with that ID — or none exists. */
export async function updateClient(
  firmId: string,
  clientId: string,
  input: UpdateClientInput,
): Promise<boolean> {
  const count = await repo.updateOwnedClient(firmId, clientId, {
    businessName: input.businessName,
    legalName: orNull(input.legalName),
    abn: orNull(input.abn),
    industry: orNull(input.industry),
    email: orNull(input.email),
    phone: orNull(input.phone),
    entityType: input.entityType,
    gstRegistered: input.gstRegistered,
    gstBasis: input.gstBasis,
    basFrequency: input.basFrequency,
    ...entityFields(input),
  });
  return count > 0;
}

/**
 * Clients are archived, never deleted: their transactions, journals and lodged
 * figures have to stay reproducible. See §6 "Data" in CLAUDE.md.
 */
export async function setClientArchived(
  firmId: string,
  clientId: string,
  archived: boolean,
): Promise<boolean> {
  const count = await repo.updateOwnedClient(firmId, clientId, {
    archivedAt: archived ? new Date() : null,
  });
  return count > 0;
}

/**
 * A standing instruction about this client — the apportionment, the odd
 * arrangement, the thing the next person needs to know before they code.
 *
 * `create` cannot carry an ownership path, so the parent is resolved through
 * one first: a bare `clientId` from the request is never trusted on its own.
 */
export async function addClientNote(
  firmId: string,
  clientId: string,
  input: ClientNoteInput,
): Promise<boolean> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return false;

  await repo.createClientNote(client.id, input.title, input.body);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Partners                                                                   */
/* -------------------------------------------------------------------------- */

/** `null` when the firm does not own the client. */
export async function getPartners(firmId: string, clientId: string): Promise<Partner[] | null> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return repo.listPartners(firmId, client.id);
}

/**
 * Replace a partnership's partners. Only a PARTNERSHIP has partners; for any
 * other entity the request is refused rather than stored and ignored, because
 * a share table on a company would later be read as meaning something.
 */
export async function savePartners(
  firmId: string,
  userId: string,
  clientId: string,
  input: PartnersInput,
): Promise<ActionResult> {
  const client = await repo.findClientHeader(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };
  if (client.entityType !== "PARTNERSHIP") {
    return { ok: false, error: "Only a partnership has partners" };
  }

  const before = await repo.listPartners(firmId, client.id);

  await db.$transaction(async (tx) => {
    await repo.replacePartners(tx, client.id, input.partners);
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "PARTNERS_UPDATED",
      entityType: "Client",
      entityId: client.id,
      before: before.map((p) => ({ name: p.name, shareBasisPoints: p.shareBasisPoints })),
      after: input.partners.map((p) => ({ name: p.name, shareBasisPoints: p.shareBasisPoints })),
    });
  });

  return { ok: true, id: client.id };
}

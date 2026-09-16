import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getStorage } from "@/server/core/storage";
import { checkLogo, sniffImage } from "./logo";
import type {
  ClientDetail,
  ClientHeader,
  ClientNote,
  ClientOverview,
  ClientOption,
  ClientRow,
  Partner,
  TrustDetails,
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
  TrustDetailsInput,
} from "./schema";
import { TRUST_ENTITIES } from "./schema";

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
    incomeTaxRatePercent: input.entityType === "COMPANY" ? (input.incomeTaxRatePercent ?? 25) : null,
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
  const { archivedAt, logoKey, ...rest } = row;
  return { ...rest, archived: archivedAt !== null, hasLogo: logoKey !== null };
}

export async function getClientDetail(
  firmId: string,
  clientId: string,
): Promise<ClientDetail | null> {
  const row = await repo.findClientDetail(firmId, clientId);
  if (!row) return null;
  const { archivedAt: _archivedAt, logoKey, ...detail } = row;
  return { ...detail, hasLogo: logoKey !== null };
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

/**
 * Whether any report could show anything: a transaction or a journal exists.
 * `null` when the firm does not own the client.
 */
export async function hasClientLedgerData(firmId: string, clientId: string): Promise<boolean | null> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const [counts, journalCount] = await Promise.all([
    countTransactionsByStatus(firmId, client.id),
    ledger.countEntries(firmId, client.id),
  ]);
  return counts.transactions > 0 || journalCount > 0;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every client mutation is audited inside the write's own transaction. A
 * client's ABN, entity type, GST registration and BAS frequency decide how its
 * books are kept; a change with no trace is a change nobody can explain.
 */
export async function createClient(
  firmId: string,
  userId: string,
  input: CreateClientInput,
): Promise<{ id: string }> {
  const data = {
    firmId,
    businessName: input.businessName,
    abn: orNull(input.abn),
    industry: orNull(input.industry),
    entityType: input.entityType,
    gstRegistered: input.gstRegistered,
    ...entityFields(input),
  };
  return db.$transaction(async (tx) => {
    const created = await repo.createClient(tx, data);
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: created.id,
      action: "CLIENT_CREATED",
      entityType: "Client",
      entityId: created.id,
      after: { businessName: data.businessName, abn: data.abn, entityType: data.entityType, gstRegistered: data.gstRegistered },
    });
    return created;
  });
}

export type UpdateOutcome = "updated" | "not_found" | "conflict";

/**
 * Optimistic: the form carries the version it was opened with, and a stale
 * edit is refused rather than merged over a colleague's. "not_found" for a
 * client the firm does not own — never "forbidden".
 */
export async function updateClient(
  firmId: string,
  userId: string,
  clientId: string,
  input: UpdateClientInput,
): Promise<UpdateOutcome> {
  const before = await repo.findClientDetail(firmId, clientId);
  if (!before) return "not_found";
  if (input.version !== undefined && input.version !== before.version) return "conflict";

  const data = {
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
  };
  return db.$transaction(async (tx) => {
    const count = await repo.updateOwnedClient(tx, firmId, clientId, data, before.version);
    if (count === 0) return "conflict" as const;
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "CLIENT_UPDATED",
      entityType: "Client",
      entityId: clientId,
      before: {
        businessName: before.businessName,
        abn: before.abn,
        entityType: before.entityType,
        gstRegistered: before.gstRegistered,
        gstBasis: before.gstBasis,
        basFrequency: before.basFrequency,
      },
      after: {
        businessName: data.businessName,
        abn: data.abn,
        entityType: data.entityType,
        gstRegistered: data.gstRegistered,
        gstBasis: data.gstBasis,
        basFrequency: data.basFrequency,
      },
    });
    return "updated" as const;
  });
}

/**
 * Clients are archived, never deleted: their transactions, journals and lodged
 * figures have to stay reproducible. See §6 "Data" in CLAUDE.md.
 */
export async function setClientArchived(
  firmId: string,
  userId: string,
  clientId: string,
  archived: boolean,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const count = await repo.updateOwnedClient(tx, firmId, clientId, { archivedAt: archived ? new Date() : null });
    if (count === 0) return false;
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: archived ? "CLIENT_ARCHIVED" : "CLIENT_RESTORED",
      entityType: "Client",
      entityId: clientId,
      after: { archived },
    });
    return true;
  });
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
  userId: string,
  clientId: string,
  input: ClientNoteInput,
): Promise<boolean> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return false;

  await db.$transaction(async (tx) => {
    const note = await repo.createClientNote(tx, client.id, input.title, input.body);
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "CLIENT_NOTE_ADDED",
      entityType: "ClientNote",
      entityId: note.id,
      after: { title: input.title },
    });
  });
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

/* -------------------------------------------------------------------------- */
/* Trust details                                                              */
/* -------------------------------------------------------------------------- */

/** `null` when the firm does not own the client. */
export async function getTrustDetails(firmId: string, clientId: string): Promise<TrustDetails | null> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return repo.findTrustDetails(firmId, client.id);
}

/**
 * Replace a trust's trustee and beneficiaries. Only a unit or discretionary
 * trust has them; for any other entity the request is refused rather than
 * stored and ignored, for the same reason partners are.
 */
export async function saveTrustDetails(
  firmId: string,
  userId: string,
  clientId: string,
  input: TrustDetailsInput,
): Promise<ActionResult> {
  const client = await repo.findClientHeader(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };
  if (!TRUST_ENTITIES.has(client.entityType)) {
    return { ok: false, error: "Only a unit trust or a discretionary trust has a trustee and beneficiaries" };
  }

  const before = await repo.findTrustDetails(firmId, client.id);
  const trustee = {
    kind: input.trustee.kind,
    name: input.trustee.name,
    abn: input.trustee.kind === "CORPORATE" ? orNull(input.trustee.abn) : null,
    signatories: input.trustee.signatories,
  };

  await db.$transaction(async (tx) => {
    await repo.replaceTrustDetails(tx, client.id, { trustee, beneficiaries: input.beneficiaries });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "TRUST_DETAILS_UPDATED",
      entityType: "Client",
      entityId: client.id,
      before: {
        trustee: before.trustee
          ? { kind: before.trustee.kind, name: before.trustee.name, abn: before.trustee.abn, signatories: before.trustee.signatories }
          : null,
        beneficiaries: before.beneficiaries.map((b) => ({ name: b.name, kind: b.kind })),
      },
      after: { trustee, beneficiaries: input.beneficiaries.map((b) => ({ name: b.name, kind: b.kind })) },
    });
  });

  return { ok: true, id: client.id };
}

/* -------------------------------------------------------------------------- */
/* Notes and logo                                                             */
/* -------------------------------------------------------------------------- */

/** `null` when the firm does not own the client. */
export async function getClientNotes(firmId: string, clientId: string): Promise<ClientNote[] | null> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return repo.listClientNotes(firmId, client.id);
}

/**
 * Store a logo. The bytes decide whether it is an image; the key carries the
 * firm and the client, and changes on every upload so a stale copy is never
 * served under a new one. The previous object is left in place: storage is
 * append-only here, like everything else that was once shown to a user.
 */
export async function setClientLogo(firmId: string, userId: string, clientId: string, bytes: Uint8Array): Promise<ActionResult> {
  const client = await repo.findOwnedClientId(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };

  const checked = checkLogo(bytes);
  if (!checked.ok) return { ok: false, error: checked.error, field: "logo" };

  const key = `${firmId}/clients/${client.id}/logo-${Date.now()}.${checked.kind.ext}`;
  await getStorage().put(key, Buffer.from(bytes), checked.kind.contentType);
  await db.$transaction(async (tx) => {
    await repo.updateOwnedClient(tx, firmId, client.id, { logoKey: key });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "CLIENT_LOGO_UPDATED",
      entityType: "Client",
      entityId: client.id,
      after: { storageKey: key, bytes: bytes.byteLength },
    });
  });
  return { ok: true, id: client.id };
}

/** `false` when the firm does not own the client. */
export async function removeClientLogo(firmId: string, userId: string, clientId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const count = await repo.updateOwnedClient(tx, firmId, clientId, { logoKey: null });
    if (count === 0) return false;
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "CLIENT_LOGO_REMOVED",
      entityType: "Client",
      entityId: clientId,
    });
    return true;
  });
}

/** The stored logo, or `null` when there is none — or the client is not this firm's. */
export async function getClientLogo(
  firmId: string,
  clientId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = await repo.findClientLogoKey(firmId, clientId);
  if (!row?.logoKey) return null;
  const bytes = await getStorage().get(row.logoKey);
  const kind = sniffImage(bytes);
  if (!kind) return null;
  return { bytes, contentType: kind.contentType };
}

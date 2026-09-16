import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getMailer, mailIsConsoleOnly } from "@/server/core/mail";
import type {
  FeedConnectionRow,
  FeedInstitutionOption,
  FeedRequestRow,
  FeedSyncRunRow,
} from "@/shared/contracts/bank-account";
import type { ActionResult } from "@/shared/contracts/result";
import { feedErrorMessage, FiskilConfigError } from "./fiskil/errors";
import { getFeedProvider, feedProviderName, type FeedConsent } from "./feed-provider";

/**
 * The live bank feed lifecycle.
 *
 * Two halves, and they are genuinely different things:
 *
 *  - A **request** asks the client, by email, to authorise a feed. It is our
 *    own artefact: a token the client's link carries, of which only the hash
 *    is stored. It exists so the work of asking survives a provider outage,
 *    a missing credential, or a client who takes a fortnight to reply.
 *  - A **connection** is a CDR consent at Fiskil. It is the provider's
 *    artefact, and the provider is authoritative about it — `refreshConnections`
 *    reconciles our rows against their list rather than trusting local state.
 *
 * Everything in this file takes `firmId` and puts it inside the query. An id
 * from another tenant resolves to nothing, and the caller is told "not found",
 * never "forbidden". See .claude/skills/tenant-security/SKILL.md.
 */

const REQUEST_DAYS = 14;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** How close to expiry a consent has to be before the UI nags. */
const RENEWAL_WINDOW_DAYS = 21;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listFeedRequests(
  firmId: string,
  clientId: string,
): Promise<FeedRequestRow[] | null> {
  const client = await db.client.findFirst({ where: { id: clientId, firmId }, select: { id: true } });
  if (!client) return null;

  const rows = await db.bankFeedRequest.findMany({
    where: { clientId: client.id },
    orderBy: { sentAt: "desc" },
    select: { id: true, email: true, status: true, sentAt: true, expiresAt: true, respondedAt: true },
  });

  // Expiry without a job: a pending request past its date simply reads as
  // expired. The stored status is only corrected when something acts on it.
  const now = Date.now();
  return rows.map((row) =>
    row.status === "PENDING" && row.expiresAt.getTime() < now ? { ...row, status: "EXPIRED" } : row,
  );
}

export async function listFeedConnections(
  firmId: string,
  clientId: string,
): Promise<FeedConnectionRow[] | null> {
  const client = await db.client.findFirst({ where: { id: clientId, firmId }, select: { id: true } });
  if (!client) return null;

  const rows = await db.bankFeedConnection.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      status: true,
      institutionName: true,
      consentedAt: true,
      expiresAt: true,
      revokedAt: true,
      lastSyncedAt: true,
      lastError: true,
      createdAt: true,
      arrangementId: true,
      _count: { select: { bankAccounts: true } },
    },
  });

  const renewalCutoff = Date.now() + RENEWAL_WINDOW_DAYS * 86_400_000;

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    // A consent past its end date is expired whatever the stored status says;
    // the client has to re-authorise before any more data can arrive.
    status:
      row.status === "ACTIVE" && row.expiresAt && row.expiresAt.getTime() < Date.now()
        ? "EXPIRED"
        : row.status,
    institutionName: row.institutionName,
    consentedAt: row.consentedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    accountCount: row._count.bankAccounts,
    /** Drives the "renew this consent" prompt, so it is computed once, here. */
    needsRenewal:
      row.status === "ACTIVE" && row.expiresAt !== null && row.expiresAt.getTime() < renewalCutoff,
    canRevoke: row.status !== "REVOKED" && row.arrangementId !== null,
  }));
}

export async function listSyncRuns(
  firmId: string,
  clientId: string,
  take = 20,
): Promise<FeedSyncRunRow[] | null> {
  const client = await db.client.findFirst({ where: { id: clientId, firmId }, select: { id: true } });
  if (!client) return null;

  return db.feedSyncRun.findMany({
    where: { clientId: client.id },
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true,
      trigger: true,
      event: true,
      status: true,
      pagesFetched: true,
      rowsInserted: true,
      rowsUpdated: true,
      error: true,
      startedAt: true,
      finishedAt: true,
    },
  });
}

/**
 * Live balances, keyed by OUR bank account id.
 *
 * Deliberately not cached and deliberately not stored: Fiskil requires account
 * and balance data to be retrieved fresh, and a stale balance on an
 * accountant's screen is worse than a slow one. What we persist is the opaque
 * account reference, so a transaction has a ledger anchor.
 *
 * The provider's account ids are resolved to ours HERE, on the server, so no
 * Fiskil identifier reaches the browser. Failures are returned as a message
 * rather than thrown: the page still has to render the accounts and their
 * transactions when the provider is briefly unreachable.
 */
export async function listLiveBalances(
  firmId: string,
  clientId: string,
): Promise<{ balances: Record<string, number | null>; error: string | null } | null> {
  const client = await db.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true, feedEndUserId: true },
  });
  if (!client) return null;

  const provider = getFeedProvider();
  if (!provider || !client.feedEndUserId) return { balances: {}, error: null };

  const accounts = await db.bankAccount.findMany({
    where: { clientId: client.id, externalAccountId: { not: null } },
    select: { id: true, externalAccountId: true },
  });
  if (accounts.length === 0) return { balances: {}, error: null };

  try {
    const live = await provider.listBalances(client.feedEndUserId);
    const byExternalId = new Map(live.map((balance) => [balance.externalAccountId, balance]));

    const balances: Record<string, number | null> = {};
    for (const account of accounts) {
      balances[account.id] = byExternalId.get(account.externalAccountId!)?.currentCents ?? null;
    }
    return { balances, error: null };
  } catch (error) {
    return { balances: {}, error: feedErrorMessage(error) };
  }
}

/** The bank picker. Empty when the provider is not configured. */
export async function listInstitutions(): Promise<FeedInstitutionOption[]> {
  const provider = getFeedProvider();
  if (!provider) return [];
  try {
    return await provider.listInstitutions();
  } catch {
    // A missing picker degrades to "let the client choose at Fiskil", which
    // is a working flow. It is not worth failing the page for.
    return [];
  }
}

/** The connection the firm owns, or null — for sync, renewal and revocation. */
export function findOwnedConnection(firmId: string, connectionId: string) {
  return db.bankFeedConnection.findFirst({
    where: { id: connectionId, client: { firmId } },
    select: {
      id: true,
      clientId: true,
      status: true,
      arrangementId: true,
      externalUserId: true,
      externalConnectionId: true,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Provisioning the client at the provider                                    */
/* -------------------------------------------------------------------------- */

/**
 * The client's identity at Fiskil, created on first use.
 *
 * Lazy on purpose: creating an end user for every client at sign-up would
 * push personal data to a third party for clients who never connect a feed,
 * which is exactly the kind of thing the CDR regime is about. It happens when
 * the firm actually asks for a feed, and not before.
 *
 * Stored back on `Client.feedEndUserId`, which is unique, so a double submit
 * cannot leave two Fiskil end users pointing at one client.
 */
async function ensureEndUser(
  firmId: string,
  clientId: string,
  email: string,
): Promise<{ ok: true; endUserId: string } | { ok: false; error: string }> {
  const provider = getFeedProvider();
  if (!provider) {
    return { ok: false, error: `${feedProviderName()} is not configured for this environment` };
  }

  const client = await db.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true, businessName: true, legalName: true, abn: true, phone: true, feedEndUserId: true },
  });
  if (!client) return { ok: false, error: "Client not found" };
  if (client.feedEndUserId) return { ok: true, endUserId: client.feedEndUserId };

  try {
    const endUserId = await provider.createEndUser({
      name: client.legalName ?? client.businessName,
      email,
      ...(client.phone ? { phone: client.phone } : {}),
      ...(client.abn ? { abn: client.abn } : {}),
    });

    // `updateMany` with the firm in the `where`: the ownership path is part of
    // the write, not a check that preceded it.
    await db.client.updateMany({
      where: { id: client.id, firmId, feedEndUserId: null },
      data: { feedEndUserId: endUserId },
    });

    const saved = await db.client.findFirst({
      where: { id: client.id, firmId },
      select: { feedEndUserId: true },
    });
    // A concurrent request won the race. Theirs is the one Fiskil and we agree
    // on, so it wins here too.
    return { ok: true, endUserId: saved?.feedEndUserId ?? endUserId };
  } catch (error) {
    return { ok: false, error: feedErrorMessage(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Consents                                                                   */
/* -------------------------------------------------------------------------- */

export type StartConnectionResult =
  | {
      ok: true;
      connectionId: string;
      /** For the Link SDK in the browser. Authorises nothing on its own. */
      sessionId: string;
      /** For the hosted redirect flow, and for emailing to a client. */
      authUrl: string;
    }
  | { ok: false; error: string; field?: string };

/**
 * Begin a consent.
 *
 * The browser receives only the short-lived session id — the Fiskil client
 * secret never leaves this process. A `PENDING` connection row is written
 * before the client goes anywhere, so an abandoned consent is visible as an
 * unfinished attempt rather than vanishing without trace.
 *
 * `renewConnectionId` re-authorises an existing arrangement instead of
 * creating a new one, which is how a consent nearing expiry is renewed.
 */
export async function startFeedConnection(
  firmId: string,
  userId: string | null,
  clientId: string,
  input: { email: string; institutionId?: string | undefined; renewConnectionId?: string | undefined },
): Promise<StartConnectionResult> {
  const provider = getFeedProvider();
  if (!provider) {
    return { ok: false, error: `${feedProviderName()} is not configured for this environment` };
  }

  const provisioned = await ensureEndUser(firmId, clientId, input.email);
  if (!provisioned.ok) return { ok: false, error: provisioned.error };

  let arrangementId: string | undefined;
  if (input.renewConnectionId) {
    const existing = await findOwnedConnection(firmId, input.renewConnectionId);
    if (!existing) return { ok: false, error: "Connection not found" };
    arrangementId = existing.arrangementId ?? undefined;
  }

  let session: Awaited<ReturnType<typeof provider.createAuthSession>>;
  try {
    session = await provider.createAuthSession({
      externalUserId: provisioned.endUserId,
      institutionId: input.institutionId,
      arrangementId,
    });
  } catch (error) {
    if (error instanceof FiskilConfigError) return { ok: false, error: error.message };
    return { ok: false, error: feedErrorMessage(error) };
  }

  const connectionId = await db.$transaction(async (tx) => {
    const created = await tx.bankFeedConnection.create({
      data: {
        clientId,
        provider: provider.name,
        externalUserId: provisioned.endUserId,
        status: "PENDING",
        authSessionId: session.sessionId,
        authSessionExpiresAt: session.expiresAt,
        ...(input.institutionId ? { institutionId: input.institutionId } : {}),
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "BANK_FEED_CONNECTED",
      entityType: "BankFeedConnection",
      entityId: created.id,
      // The session id is deliberately absent: an audit row is read by people,
      // and it does not need a credential-adjacent value to be meaningful.
      after: { provider: provider.name, institutionId: input.institutionId ?? null, renewal: Boolean(arrangementId) },
    });
    return created.id;
  });

  return { ok: true, connectionId, sessionId: session.sessionId, authUrl: session.authUrl };
}

/**
 * The Link SDK resolved in the browser with a consent id.
 *
 * Optimistic only — the webhook is authoritative and arrives shortly after —
 * but recording it here means the screen updates immediately instead of
 * looking broken for ten seconds. The webhook handler is idempotent, so the
 * duplicate is harmless.
 */
export async function completeFeedConnection(
  firmId: string,
  userId: string | null,
  connectionId: string,
  externalConnectionId: string,
): Promise<ActionResult> {
  const connection = await findOwnedConnection(firmId, connectionId);
  if (!connection) return { ok: false, error: "Connection not found" };

  // The consent row, the request it answers and the audit entry are one
  // transaction: a consent that is active with no record of becoming so is
  // exactly the half-state an auditor asks about.
  await db.$transaction(async (tx) => {
    await tx.bankFeedConnection.updateMany({
      where: { id: connection.id, client: { firmId } },
      data: {
        externalConnectionId: connection.externalConnectionId ?? externalConnectionId,
        arrangementId: connection.arrangementId ?? externalConnectionId,
        status: connection.status === "PENDING" ? "ACTIVE" : connection.status,
        consentedAt: new Date(),
      },
    });

    // Tie the email request that produced this consent to the consent itself, so
    // "we asked on the 3rd, they authorised on the 9th" is one readable story.
    await tx.bankFeedRequest.updateMany({
      where: { clientId: connection.clientId, status: "CONNECTED", connectionId: null },
      data: { connectionId: connection.id },
    });

    await recordAudit(tx, {
      firmId,
      userId,
      clientId: connection.clientId,
      action: "BANK_FEED_CONNECTED",
      entityType: "BankFeedConnection",
      entityId: connection.id,
      after: { by: userId ? "firm" : "client", externalConnectionId, activated: connection.status === "PENDING" },
    });
  });

  return { ok: true, id: connection.id };
}

/**
 * Reconcile our connection rows against the provider's consent list.
 *
 * The provider is the authority on consent state: a client can revoke at their
 * bank or through Fiskil's own dashboard, and we would never hear about it if
 * we only trusted local rows and webhooks. This is the repair mechanism.
 */
export async function refreshConnections(
  firmId: string,
  userId: string | null,
  clientId: string,
): Promise<ActionResult> {
  const provider = getFeedProvider();
  if (!provider) return { ok: false, error: `${feedProviderName()} is not configured` };

  const client = await db.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true, feedEndUserId: true },
  });
  if (!client) return { ok: false, error: "Client not found" };
  if (!client.feedEndUserId) return { ok: true, id: client.id };

  let consents: FeedConsent[];
  try {
    consents = await provider.listConsents(client.feedEndUserId);
  } catch (error) {
    return { ok: false, error: feedErrorMessage(error) };
  }

  // Every row the provider's list changes, the expiry sweep and the audit
  // entry commit together: the audit row describes exactly the state it
  // landed with, never a state that was half-written when the process died.
  await db.$transaction(async (tx) => {
    for (const consent of consents) {
      await tx.bankFeedConnection.upsert({
        where: {
          provider_externalConnectionId: {
            provider: provider.name,
            externalConnectionId: consent.externalConnectionId,
          },
        },
        update: {
          status: consent.status,
          arrangementId: consent.arrangementId,
          institutionId: consent.institutionId,
          institutionName: consent.institutionName,
          expiresAt: consent.expiresAt,
          revokedAt: consent.revokedAt,
        },
        create: {
          clientId: client.id,
          provider: provider.name,
          externalUserId: client.feedEndUserId!,
          externalConnectionId: consent.externalConnectionId,
          arrangementId: consent.arrangementId,
          institutionId: consent.institutionId,
          institutionName: consent.institutionName,
          status: consent.status,
          consentedAt: consent.consentedAt,
          expiresAt: consent.expiresAt,
          revokedAt: consent.revokedAt,
        },
      });
    }

    // A PENDING row whose auth session has lapsed is an abandoned consent. It is
    // marked, not deleted: "the client started and did not finish" is useful.
    await tx.bankFeedConnection.updateMany({
      where: {
        clientId: client.id,
        status: "PENDING",
        authSessionExpiresAt: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });

    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "BANK_FEED_REFRESHED",
      entityType: "BankFeedConnection",
      entityId: client.id,
      after: { consents: consents.length },
    });
  });

  return { ok: true, id: client.id };
}

/**
 * Revoke a CDR consent.
 *
 * Fiskil is told first. If that fails the local row is left untouched, because
 * a row saying "revoked" while the consent is still live at the bank would be
 * a false statement about what data we are entitled to receive. The row is
 * never deleted: it is the record of a permission that once existed.
 */
export async function revokeFeedConnection(
  firmId: string,
  userId: string,
  connectionId: string,
): Promise<ActionResult> {
  const connection = await findOwnedConnection(firmId, connectionId);
  if (!connection) return { ok: false, error: "Connection not found" };
  if (connection.status === "REVOKED") return { ok: true, id: connection.id };

  const provider = getFeedProvider();
  if (provider && connection.arrangementId) {
    try {
      await provider.revokeConsent(connection.arrangementId);
    } catch (error) {
      return { ok: false, error: feedErrorMessage(error) };
    }
  } else if (provider && !connection.arrangementId) {
    // Nothing exists at the provider yet — an abandoned consent attempt. Mark
    // it locally so the screen is not stuck showing a pending connection.
    await db.$transaction(async (tx) => {
      await tx.bankFeedConnection.updateMany({
        where: { id: connection.id, client: { firmId } },
        data: { status: "EXPIRED" },
      });
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: connection.clientId,
        action: "BANK_FEED_REVOKED",
        entityType: "BankFeedConnection",
        entityId: connection.id,
        after: { by: "firm", outcome: "abandoned attempt marked expired" },
      });
    });
    return { ok: true, id: connection.id };
  }

  await db.$transaction(async (tx) => {
    await tx.bankFeedConnection.update({
      where: { id: connection.id },
      data: { status: "REVOKED", revokedAt: new Date(), lastError: null },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: connection.clientId,
      action: "BANK_FEED_REVOKED",
      entityType: "BankFeedConnection",
      entityId: connection.id,
      after: { by: "firm" },
    });
  });

  return { ok: true, id: connection.id };
}

/* -------------------------------------------------------------------------- */
/* Feed requests — our own asking mechanism                                   */
/* -------------------------------------------------------------------------- */

export type FeedRequestResult =
  | { ok: true; id: string; previewUrl: string | null }
  | { ok: false; error: string; field?: string };

export async function requestBankFeed(
  firmId: string,
  userId: string,
  clientId: string,
  email: string,
  baseUrl: string,
): Promise<FeedRequestResult> {
  const client = await db.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true, businessName: true, firm: { select: { name: true } } },
  });
  if (!client) return { ok: false, error: "Client not found" };

  // The token IS the credential for the public page, so it is random, long,
  // and only its hash is stored — a leaked database gives no working links.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REQUEST_DAYS * 86_400_000);

  const id = await db.$transaction(async (tx) => {
    const created = await tx.bankFeedRequest.create({
      data: { clientId: client.id, email, tokenHash: hashToken(token), expiresAt },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "BANK_FEED_REQUESTED",
      entityType: "BankFeedRequest",
      entityId: created.id,
      after: { email, expiresAt: expiresAt.toISOString() },
    });
    return created.id;
  });

  const link = `${baseUrl}/feed/${token}`;
  await getMailer().send({
    to: email,
    subject: `${client.businessName}: authorise a bank feed`,
    text:
      `${client.firm.name} has asked to connect a secure bank feed for ${client.businessName}.\n\n` +
      `You will be taken to your own bank to approve it. Your bank login details are never ` +
      `shared with ${client.firm.name} — only the transaction data you approve is.\n\n` +
      `Review and respond here (the link expires in ${REQUEST_DAYS} days):\n${link}\n\n` +
      `If you were not expecting this, you can ignore it.`,
  });

  return { ok: true, id, previewUrl: mailIsConsoleOnly() ? `/feed/${token}` : null };
}

export async function cancelFeedRequest(
  firmId: string,
  userId: string,
  requestId: string,
): Promise<ActionResult> {
  const request = await db.bankFeedRequest.findFirst({
    where: { id: requestId, client: { firmId } },
    select: { id: true, clientId: true, status: true },
  });
  if (!request) return { ok: false, error: "Request not found" };
  if (request.status !== "PENDING") return { ok: false, error: "Only a pending request can be withdrawn" };

  await db.$transaction(async (tx) => {
    await tx.bankFeedRequest.update({
      where: { id: request.id },
      data: { status: "EXPIRED", respondedAt: new Date() },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: request.clientId,
      action: "BANK_FEED_RESPONDED",
      entityType: "BankFeedRequest",
      entityId: request.id,
      after: { status: "EXPIRED", by: "firm" },
    });
  });

  return { ok: true, id: request.id };
}

/* -------------------------------------------------------------------------- */
/* The client's side — reached by token, not by session                       */
/* -------------------------------------------------------------------------- */

export interface FeedRequestView {
  id: string;
  businessName: string;
  firmName: string;
  providerName: string;
  status: "PENDING" | "CONNECTED" | "DECLINED" | "EXPIRED";
  expiresAt: Date;
}

export async function findFeedRequestByToken(token: string): Promise<FeedRequestView | null> {
  // Shape-check before touching the database, so a junk URL costs nothing.
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;

  const row = await db.bankFeedRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      client: { select: { businessName: true, firm: { select: { name: true } } } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    businessName: row.client.businessName,
    firmName: row.client.firm.name,
    providerName: feedProviderName(),
    status: row.status === "PENDING" && row.expiresAt.getTime() < Date.now() ? "EXPIRED" : row.status,
    expiresAt: row.expiresAt,
  };
}

export interface FeedResponseResult {
  recorded: boolean;
  /** Where to send the client to authorise at their bank, when they approved. */
  consentUrl: string | null;
  error: string | null;
}

/**
 * The client's answer, given without signing in — the token is the credential.
 *
 * On approval with a provider configured, a consent is started and its hosted
 * URL returned so the client goes straight to their bank. Without a provider
 * the approval is still recorded: the firm knows the client said yes, and can
 * connect when credentials exist.
 */
export async function respondToFeedRequest(
  token: string,
  approve: boolean,
  baseUrl: string,
): Promise<FeedResponseResult> {
  const view = await findFeedRequestByToken(token);
  if (!view || view.status !== "PENDING") {
    return { recorded: false, consentUrl: null, error: null };
  }

  const row = await db.bankFeedRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, clientId: true, email: true, client: { select: { firmId: true } } },
  });
  if (!row) return { recorded: false, consentUrl: null, error: null };

  await db.$transaction(async (tx) => {
    await tx.bankFeedRequest.update({
      where: { id: row.id },
      data: { status: approve ? "CONNECTED" : "DECLINED", respondedAt: new Date() },
    });
    await recordAudit(tx, {
      firmId: row.client.firmId,
      // No user: the client answered, and they do not have an account here.
      userId: null,
      clientId: row.clientId,
      action: "BANK_FEED_RESPONDED",
      entityType: "BankFeedRequest",
      entityId: row.id,
      after: { status: approve ? "CONNECTED" : "DECLINED", by: "client" },
    });
  });

  if (!approve || !getFeedProvider()) {
    return { recorded: true, consentUrl: null, error: null };
  }

  const started = await startFeedConnection(row.client.firmId, null, row.clientId, {
    email: row.email,
  });
  if (!started.ok) {
    // The answer is recorded either way — the firm must not lose the fact that
    // the client agreed just because Fiskil was briefly unreachable.
    return { recorded: true, consentUrl: null, error: started.error };
  }

  await db.bankFeedRequest.updateMany({
    where: { id: row.id, client: { firmId: row.client.firmId } },
    data: { connectionId: started.connectionId },
  });

  return { recorded: true, consentUrl: started.authUrl, error: null };
}

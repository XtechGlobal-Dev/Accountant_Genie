"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/server/core/session";
import { enqueue } from "@/server/jobs/queue";
import { can, forbidden } from "@/server/core/permissions";
import { invalid, notFound, ok } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import * as feeds from "./feeds";
import { bankAccountFromForm, feedConnectionFromForm } from "./schema";
import * as service from "./service";

/** The transport edge of the banking module. Session, validate, call, revalidate. */

export async function createBankAccount(
  clientId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId } = session;

  const parsed = bankAccountFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const account = await service.createAccount(firmId, session.userId, clientId, parsed.data);
  if (!account) return notFound("Client");

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/banks`);
  return ok(account.id);
}

export async function updateBankAccount(
  bankAccountId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId } = session;

  const parsed = bankAccountFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const account = await service.updateAccount(firmId, session.userId, bankAccountId, parsed.data);
  if (!account) return notFound("Bank account");

  revalidatePath(`/clients/${account.clientId}`);
  revalidatePath(`/clients/${account.clientId}/banks`);
  return ok(account.id);
}

/* -------------------------------------------------------------------------- */
/* Live feeds                                                                 */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function baseUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Start a consent for a client sitting with the accountant.
 *
 * Returns the auth session id, which the browser hands to the Fiskil Link SDK.
 * That id is short-lived and authorises nothing by itself — the client still
 * has to authenticate at their own bank — which is why it is safe to return
 * while the client secret never leaves the server.
 */
export async function startFeedConnection(
  clientId: string,
  formData: FormData,
): Promise<feeds.StartConnectionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();

  const parsed = feedConnectionFromForm(formData);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") || undefined };
  }

  const result = await feeds.startFeedConnection(session.firmId, session.userId, clientId, {
    email: parsed.data.email,
    institutionId: parsed.data.institutionId,
    renewConnectionId: parsed.data.renewConnectionId,
    // Fiskil refuses a session with no return URL, so this is required, not
    // decorative. Taken from the request rather than configuration so it lands
    // on THIS client's Banks page and needs no environment setup.
    baseUrl: await baseUrl(),
  });
  if (result.ok) revalidatePath(`/clients/${clientId}/banks`);
  return result;
}

/** The Link SDK resolved in the browser. Optimistic — the webhook is authoritative. */
export async function completeFeedConnection(
  clientId: string,
  connectionId: string,
  consentId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  if (!consentId.trim()) return { ok: false, error: "No consent was returned" };

  const result = await feeds.completeFeedConnection(
    session.firmId,
    session.userId,
    connectionId,
    consentId.trim(),
  );
  if (result.ok) revalidatePath(`/clients/${clientId}/banks`);
  return result;
}

/** Re-read the provider's consent list and correct our rows against it. */
export async function refreshFeedConnections(clientId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();

  const result = await feeds.refreshConnections(session.firmId, session.userId, clientId);
  if (result.ok) revalidatePath(`/clients/${clientId}/banks`);
  return result;
}

/**
 * Pull new transactions now.
 *
 * Runs as a job so progress reaches the Activity Panel and a failure is
 * retried with backoff. The idempotency key is bucketed to the minute, so
 * double-clicking "Sync now" enqueues one job, not two.
 */
export async function syncFeed(clientId: string, connectionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:update")) return forbidden();

  const connection = await feeds.findOwnedConnection(session.firmId, connectionId);
  if (!connection) return notFound("Connection");
  if (connection.status === "REVOKED") return { ok: false, error: "This consent has been revoked" };
  if (connection.status === "PENDING") {
    return { ok: false, error: "The client has not finished authorising this feed yet" };
  }

  const job = await enqueue({
    type: "SYNC_BANK_FEED",
    firmId: session.firmId,
    clientId: connection.clientId,
    inputReference: connection.id,
    idempotencyKey: `feed-sync:${connection.id}:${Math.floor(Date.now() / 60_000)}`,
    createdById: session.userId,
  });

  revalidatePath(`/clients/${clientId}/banks`);
  return { ok: true, id: job.id };
}

export async function revokeFeedConnection(
  clientId: string,
  connectionId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();

  const result = await feeds.revokeFeedConnection(session.firmId, session.userId, connectionId);
  if (result.ok) {
    revalidatePath(`/clients/${clientId}/banks`);
    revalidatePath(`/clients/${clientId}`);
  }
  return result;
}

export async function requestBankFeed(
  clientId: string,
  formData: FormData,
): Promise<feeds.FeedRequestResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId, userId } = session;

  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address", field: "email" };

  const result = await feeds.requestBankFeed(firmId, userId, clientId, email, await baseUrl());
  if (result.ok) revalidatePath(`/clients/${clientId}/banks`);
  return result;
}

export async function cancelFeedRequest(
  clientId: string,
  requestId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId, userId } = session;

  const result = await feeds.cancelFeedRequest(firmId, userId, requestId);
  if (result.ok) revalidatePath(`/clients/${clientId}/banks`);
  return result;
}

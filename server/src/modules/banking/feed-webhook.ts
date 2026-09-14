import "server-only";

import { db } from "@/server/core/db";
import { enqueue } from "@/server/jobs/queue";
import { verifyWebhook } from "./fiskil/webhook";
import { TRANSACTION_EVENTS, type FiskilWebhookPayload } from "./fiskil/types";

/**
 * The Fiskil webhook receiver.
 *
 * This is the authoritative path for feed data: Fiskil explicitly recommends
 * against polling, so the normal way a transaction reaches the ledger is that
 * Fiskil tells us there is something to fetch and we fetch it. Manual "Sync
 * now" is the fallback for when a feed has been broken and fixed.
 *
 * Four properties, in the order they are enforced:
 *
 *  1. **Authenticated.** An unsigned or wrongly signed delivery is rejected
 *     before anything is read from it. Without a signing secret configured we
 *     return 503 — refusing is correct; trusting an unauthenticated payload
 *     that moves money into a ledger is not.
 *  2. **Idempotent.** `WebhookEvent.id` is Fiskil's `message_id` and is a
 *     primary key, so the DATABASE decides whether we have seen a delivery,
 *     not application logic. Fiskil retries up to five times.
 *  3. **Fast.** We acknowledge and enqueue. A first-time backfill of several
 *     years takes far longer than Fiskil's retry window, so doing the work
 *     inline would guarantee duplicate deliveries and a timeout.
 *  4. **Tenant-resolved server-side.** The payload names a Fiskil end user;
 *     the firm is looked up from OUR record of that end user. No identifier in
 *     the request decides which tenant is written to.
 */

export interface WebhookOutcome {
  status: number;
  body: string;
}

const ok = (body: Record<string, unknown>): WebhookOutcome => ({
  status: 200,
  body: JSON.stringify(body),
});

/**
 * @param rawBody the exact bytes received. Verification is over these; a
 *   re-serialised object produces a different digest.
 */
export async function handleFeedWebhook(
  rawBody: Buffer,
  signature: string | null,
): Promise<WebhookOutcome> {
  const verdict = verifyWebhook(rawBody, signature);
  if (verdict === "unconfigured") {
    console.warn("[fiskil] webhook rejected: FISKIL_WEBHOOK_SECRET is not set");
    return { status: 503, body: JSON.stringify({ error: "Webhook signing secret is not configured" }) };
  }
  if (verdict === "invalid") {
    return { status: 401, body: JSON.stringify({ error: "Invalid signature" }) };
  }

  let payload: FiskilWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as FiskilWebhookPayload;
  } catch {
    return { status: 400, body: JSON.stringify({ error: "Malformed JSON" }) };
  }

  const messageId = payload.message_id;
  // The event name is nested inside `data`, not at the top level.
  const event = payload.data?.event;
  if (!messageId || !event) {
    return { status: 400, body: JSON.stringify({ error: "Missing message_id or data.event" }) };
  }

  const endUserId = payload.data?.end_user_id ?? null;
  const externalConnectionId = payload.data?.consent_id ?? null;

  // The replay guard is the primary key. First writer wins; a redelivery
  // conflicts and is acknowledged without being processed again.
  try {
    await db.webhookEvent.create({
      data: {
        id: messageId,
        provider: "fiskil",
        type: event,
        externalUserId: endUserId,
        externalConnectionId,
        payload: payload as object,
      },
      select: { id: true },
    });
  } catch {
    return ok({ received: true, duplicate: true });
  }

  try {
    await processEvent(messageId, event, endUserId, externalConnectionId, payload);
  } catch (error) {
    // Never fail the delivery for a processing error: Fiskil would retry, hit
    // the replay guard, and the retry would be a no-op anyway. The error is
    // recorded on the event so a stuck feed is visible rather than silent.
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    console.error(`[fiskil] ${event} (${messageId}) failed:`, message);
    await db.webhookEvent
      .update({ where: { id: messageId }, data: { error: message } })
      .catch(() => undefined);
  }

  return ok({ received: true });
}

async function processEvent(
  messageId: string,
  event: string,
  endUserId: string | null,
  externalConnectionId: string | null,
  payload: FiskilWebhookPayload,
): Promise<void> {
  if (!endUserId) {
    await markProcessed(messageId);
    return;
  }

  // THE TENANCY RESOLUTION. The firm comes from our own record of this end
  // user, never from the payload. An end user we do not know about — created
  // directly in the Fiskil Console, say — belongs to no firm and is ignored.
  const client = await db.client.findUnique({
    where: { feedEndUserId: endUserId },
    select: { id: true, firmId: true },
  });
  if (!client) {
    console.warn(`[fiskil] no client for end user ${endUserId}`);
    await markProcessed(messageId);
    return;
  }

  const connectionId = externalConnectionId
    ? await upsertConnection(client.id, client.firmId, endUserId, externalConnectionId, payload)
    : null;

  if (event === "consent.revoked") {
    await db.bankFeedConnection.updateMany({
      where: { clientId: client.id, externalConnectionId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await markProcessed(messageId);
    return;
  }

  if (event === "consent.received" || event === "consent.updated") {
    // Data is not necessarily available yet — the sync.completed events drive
    // the actual pulls. The upsert above has already recorded the state.
    await markProcessed(messageId);
    return;
  }

  if (TRANSACTION_EVENTS.has(event) && connectionId) {
    // Enqueued, not run. The job queue owns retries, backoff and the progress
    // the Activity Panel shows; this handler owns only acknowledgement.
    //
    // The idempotency key is the message id, so five deliveries of one event
    // produce one job even if they somehow bypass the replay guard.
    await enqueue({
      type: "SYNC_BANK_FEED",
      firmId: client.firmId,
      clientId: client.id,
      inputReference: connectionId,
      idempotencyKey: `feed-sync:webhook:${messageId}`,
      createdById: null,
    });
  }

  await markProcessed(messageId);
}

/**
 * Record the consent this event refers to.
 *
 * A consent can reach us by webhook before the browser finishes the Link flow,
 * so this creates the row when it does not exist. The `PENDING` row the
 * auth session created is matched first, so the two halves converge on one row
 * rather than leaving an orphaned pending attempt behind.
 */
async function upsertConnection(
  clientId: string,
  _firmId: string,
  endUserId: string,
  externalConnectionId: string,
  payload: FiskilWebhookPayload,
): Promise<string | null> {
  const institutionId = payload.data?.institution_id ?? null;

  const existing = await db.bankFeedConnection.findFirst({
    where: { clientId, externalConnectionId },
    select: { id: true, status: true },
  });
  if (existing) {
    await db.bankFeedConnection.update({
      where: { id: existing.id },
      data: {
        status: existing.status === "PENDING" ? "ACTIVE" : existing.status,
        ...(institutionId ? { institutionId } : {}),
      },
    });
    return existing.id;
  }

  // The pending row this consent came from, if the flow started here.
  const pending = await db.bankFeedConnection.findFirst({
    where: { clientId, status: "PENDING", externalConnectionId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (pending) {
    await db.bankFeedConnection.update({
      where: { id: pending.id },
      data: {
        externalConnectionId,
        arrangementId: externalConnectionId,
        status: "ACTIVE",
        consentedAt: new Date(),
        ...(institutionId ? { institutionId } : {}),
      },
    });
    return pending.id;
  }

  const created = await db.bankFeedConnection.create({
    data: {
      clientId,
      provider: "fiskil",
      externalUserId: endUserId,
      externalConnectionId,
      arrangementId: externalConnectionId,
      status: "ACTIVE",
      consentedAt: new Date(),
      institutionId,
    },
    select: { id: true },
  });
  return created.id;
}

function markProcessed(messageId: string): Promise<unknown> {
  return db.webhookEvent.update({
    where: { id: messageId },
    data: { processedAt: new Date() },
  });
}

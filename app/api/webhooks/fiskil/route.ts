import { handleFeedWebhook } from "@/server/modules/banking/feed-webhook";

/**
 * POST /api/webhooks/fiskil — Fiskil's delivery endpoint.
 *
 * The HMAC is computed over the exact bytes received, so the body is read as
 * an ArrayBuffer and nothing parses it before the handler verifies it.
 *
 * Register this URL at console.fiskil.com → Settings → Webhooks, subscribed to
 * at least `consent.received`, `consent.revoked`,
 * `banking.transactions.sync.completed` and
 * `banking.transactions.recent.sync.completed`. Event subscriptions CANNOT be
 * changed after creation — only the URL can — so subscribe generously.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  const outcome = await handleFeedWebhook(raw, request.headers.get("x-fiskil-signature"));
  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "content-type": "application/json" },
  });
}

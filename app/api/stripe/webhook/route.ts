import { handleWebhook } from "@/server/modules/billing/stripe";

/**
 * POST /api/stripe/webhook — Stripe's events. The raw body is needed for
 * signature verification, so nothing parses it before the handler does.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const outcome = await handleWebhook(raw, request.headers.get("stripe-signature"));
  return new Response(outcome.body, { status: outcome.status });
}

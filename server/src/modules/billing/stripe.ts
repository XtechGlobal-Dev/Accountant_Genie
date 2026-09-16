import "server-only";

import Stripe from "stripe";
import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { PLANS, planByCode, type PlanCode } from "./plans";

/**
 * Stripe checkout and its webhook.
 *
 * Configured by `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and one price id
 * per paid plan and interval (`STRIPE_PRICE_CORE_MONTHLY` …). Without them,
 * the plan page records a choice and says nothing is charged. With them,
 * choosing a plan opens Checkout; the webhook — signature verified, replay
 * guarded — is the only thing that changes the firm's plan afterwards.
 *
 * Card details never touch this server.
 */

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  cached = key ? new Stripe(key) : null;
  return cached;
}

export function stripeConfigured(): boolean {
  return getStripe() !== null;
}

function priceIdFor(code: PlanCode, interval: "MONTHLY" | "YEARLY"): string | null {
  return process.env[`STRIPE_PRICE_${code}_${interval}`]?.trim() || null;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export async function createCheckout(
  firmId: string,
  code: PlanCode,
  interval: "MONTHLY" | "YEARLY",
  baseUrl: string,
): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Card payments are not configured" };
  const plan = PLANS.find((p) => p.code === code);
  if (!plan || plan.monthlyCents === 0) return { ok: false, error: "That plan has no checkout" };
  const price = priceIdFor(code, interval);
  if (!price) return { ok: false, error: `No price is configured for ${plan.name} ${interval.toLowerCase()}` };

  const firm = await db.firm.findUnique({
    where: { id: firmId },
    select: { name: true, stripeCustomerId: true, users: { where: { role: "OWNER" }, take: 1, select: { email: true } } },
  });
  if (!firm) return { ok: false, error: "Firm not found" };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    ...(firm.stripeCustomerId
      ? { customer: firm.stripeCustomerId }
      : { customer_email: firm.users[0]?.email }),
    client_reference_id: firmId,
    metadata: { firmId, planCode: code, interval },
    subscription_data: { metadata: { firmId, planCode: code, interval } },
    success_url: `${baseUrl}/settings/plan?checkout=success`,
    cancel_url: `${baseUrl}/settings/plan?checkout=cancelled`,
    allow_promotion_codes: true,
  });
  if (!session.url) return { ok: false, error: "Stripe returned no checkout URL" };
  return { ok: true, url: session.url };
}

export async function createPortal(firmId: string, baseUrl: string): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Card payments are not configured" };
  const firm = await db.firm.findUnique({ where: { id: firmId }, select: { stripeCustomerId: true } });
  if (!firm?.stripeCustomerId) return { ok: false, error: "No billing account yet — choose a paid plan first" };
  const session = await stripe.billingPortal.sessions.create({
    customer: firm.stripeCustomerId,
    return_url: `${baseUrl}/settings/plan`,
  });
  return { ok: true, url: session.url };
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                    */
/* -------------------------------------------------------------------------- */

export type WebhookOutcome = { status: number; body: string };

/**
 * Verify the signature, check the event id for replay, store it, process,
 * mark processed. An unverified webhook is an unauthenticated write endpoint.
 */
export async function handleWebhook(rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return { status: 503, body: "Stripe is not configured" };
  if (!signature) return { status: 400, body: "Missing signature" };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: "Invalid signature" };
  }

  // The replay guard is the primary key, not a read-then-write: two
  // simultaneous deliveries of one event race to insert, and the database
  // decides which one processes it. The same pattern as the Fiskil receiver.
  try {
    await db.webhookEvent.create({ data: { id: event.id, provider: "stripe", type: event.type }, select: { id: true } });
  } catch {
    return { status: 200, body: "Already processed" };
  }

  try {
    await applyEvent(event);
  } catch (error) {
    // Recorded on the event, and NOT marked processed, so a crash inside the
    // plan change leaves a visible, unprocessed event rather than one every
    // Stripe retry short-circuits past.
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await db.webhookEvent.update({ where: { id: event.id }, data: { error: message } }).catch(() => undefined);
    return { status: 500, body: "Processing failed; Stripe will retry" };
  }
  await db.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return { status: 200, body: "ok" };
}

async function applyEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const firmId = session.metadata?.firmId ?? session.client_reference_id;
      const planCode = session.metadata?.planCode;
      const interval = session.metadata?.interval === "YEARLY" ? "YEARLY" : "MONTHLY";
      if (!firmId || !planCode) break;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      await applyPlan(firmId, planByCode(planCode).code, interval, customerId, subscriptionId, event.id);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const firm = await db.firm.findFirst({ where: { stripeSubscriptionId: subscription.id }, select: { id: true } });
      if (firm) await applyPlan(firm.id, "TRIAL", "MONTHLY", null, null, event.id);
      break;
    }
    default:
      break;
  }
}

async function applyPlan(
  firmId: string,
  planCode: PlanCode,
  interval: "MONTHLY" | "YEARLY",
  customerId: string | null,
  subscriptionId: string | null,
  eventId: string,
) {
  const before = await db.firm.findUnique({ where: { id: firmId }, select: { planCode: true, billingInterval: true } });
  if (!before) return;
  await db.$transaction(async (tx) => {
    await tx.firm.update({
      where: { id: firmId },
      data: {
        planCode,
        billingInterval: interval,
        planChangedAt: new Date(),
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        stripeSubscriptionId: subscriptionId,
      },
    });
    await recordAudit(tx, {
      firmId,
      userId: null,
      action: "PLAN_CHANGED",
      entityType: "Firm",
      entityId: firmId,
      before: { planCode: before.planCode, billingInterval: before.billingInterval },
      after: { planCode, billingInterval: interval, via: "stripe", eventId },
    });
  });
}

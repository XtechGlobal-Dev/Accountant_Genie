"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import type { ActionResult } from "@/shared/contracts/result";
import * as service from "./service";
import { createCheckout, createPortal, stripeConfigured, type CheckoutResult } from "./stripe";

const ChoosePlanSchema = z.object({
  code: z.enum(["TRIAL", "CORE", "GROWTH", "SCALE"]),
  interval: z.enum(["MONTHLY", "YEARLY"]),
});

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Choose a plan. With Stripe configured and a paid plan, this returns a
 * Checkout URL and the plan changes only when the webhook confirms payment.
 * Otherwise the choice is recorded directly.
 */
export async function choosePlan(payload: unknown): Promise<ActionResult | CheckoutResult> {
  const session = await requireSession();
  if (!can(session, "billing:manage")) return forbidden();

  const parsed = ChoosePlanSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Choose a plan and a billing interval" };

  if (stripeConfigured() && parsed.data.code !== "TRIAL") {
    return createCheckout(session.firmId, parsed.data.code, parsed.data.interval, await baseUrl());
  }

  const result = await service.choosePlan(session.firmId, session.userId, parsed.data.code, parsed.data.interval);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** The Stripe customer portal — invoices, card, cancellation. */
export async function openBillingPortal(): Promise<CheckoutResult> {
  const session = await requireSession();
  if (!can(session, "billing:manage")) return forbidden<CheckoutResult>();
  return createPortal(session.firmId, await baseUrl());
}

import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import * as clients from "@/server/modules/clients/repository";
import type { ActionResult } from "@/shared/contracts/result";
import type { BillingState, PlanOption } from "@/shared/contracts/billing";
import { PLANS, planByCode, type Plan } from "./plans";

/**
 * What the firm is on and how much of it is used. Choosing a plan records the
 * choice with an audit row; payment collection is a later phase, and the page
 * says so rather than pretending.
 */

function toOption(plan: Plan): PlanOption {
  return {
    code: plan.code,
    name: plan.name,
    tagline: plan.tagline,
    monthlyCents: plan.monthlyCents,
    yearlyMonthlyCents: plan.yearlyMonthlyCents,
    allowancePerYear: plan.allowancePerYear,
    features: [...plan.features],
    excludes: [...plan.excludes],
    highlighted: plan.highlighted ?? false,
  };
}

/**
 * What the plan has been used for: the sum of usage events in the current
 * plan year. Usage is metered on reconciled transactions — the append-only,
 * idempotent events acceptance writes — never on a count of rows that a
 * re-import or a reopen would move.
 */
export async function usedThisPlanYear(firmId: string): Promise<number> {
  const firm = await db.firm.findUnique({ where: { id: firmId }, select: { planChangedAt: true, createdAt: true } });
  const anchor = firm?.planChangedAt ?? firm?.createdAt ?? new Date();
  // The plan year that contains today, anchored on when the plan started.
  const start = new Date(anchor);
  while (start.getTime() + 365 * 86_400_000 <= Date.now()) start.setUTCFullYear(start.getUTCFullYear() + 1);
  const sum = await db.usageEvent.aggregate({
    where: { firmId, kind: "RECONCILED_TRANSACTION", createdAt: { gte: start } },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

export async function getBillingState(firmId: string): Promise<BillingState | null> {
  const firm = await db.firm.findUnique({
    where: { id: firmId },
    select: { planCode: true, billingInterval: true, planChangedAt: true },
  });
  if (!firm) return null;
  const [used, clientCount] = await Promise.all([
    usedThisPlanYear(firmId),
    clients.countClients(firmId, false),
  ]);
  const current = planByCode(firm.planCode);
  return {
    current: toOption(current),
    billingInterval: firm.billingInterval,
    planChangedAt: firm.planChangedAt,
    used,
    remaining: Math.max(0, current.allowancePerYear - used),
    clientCount,
    plans: PLANS.map(toOption),
  };
}

/** The allowance the workspace meter reads. */
export async function planAllowance(firmId: string): Promise<number> {
  const firm = await db.firm.findUnique({ where: { id: firmId }, select: { planCode: true } });
  return planByCode(firm?.planCode ?? "TRIAL").allowancePerYear;
}

export async function choosePlan(
  firmId: string,
  userId: string,
  code: string,
  interval: "MONTHLY" | "YEARLY",
): Promise<ActionResult> {
  const plan = PLANS.find((p) => p.code === code);
  if (!plan) return { ok: false, error: "That plan does not exist", field: "plan" };

  const before = await db.firm.findUnique({
    where: { id: firmId },
    select: { planCode: true, billingInterval: true },
  });
  if (!before) return { ok: false, error: "Firm not found" };
  if (before.planCode === plan.code && before.billingInterval === interval) {
    return { ok: true, id: plan.code };
  }

  await db.$transaction(async (tx) => {
    await tx.firm.update({
      where: { id: firmId },
      data: { planCode: plan.code, billingInterval: interval, planChangedAt: new Date() },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "PLAN_CHANGED",
      entityType: "Firm",
      entityId: firmId,
      before: { planCode: before.planCode, billingInterval: before.billingInterval },
      after: { planCode: plan.code, billingInterval: interval },
    });
  });
  return { ok: true, id: plan.code };
}

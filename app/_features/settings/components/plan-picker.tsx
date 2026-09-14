"use client";

/**
 * Choose a plan and a billing interval. Three paid plans side by side, the
 * middle one lifted; the trial is not a card because nobody chooses it.
 * Recording the choice is real; without checkout configured the page says
 * plainly that nothing is charged.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { choosePlan, openBillingPortal } from "@/server/modules/billing/actions";
import type { BillingState } from "@/shared/contracts/billing";
import { money } from "@/shared/format";
import { Icon } from "@/ui/icons";
import { Alert, Badge, Button, cx } from "@/ui/primitives";

export function PlanPicker({
  state,
  canManage,
  cardPayments,
}: {
  state: BillingState;
  canManage: boolean;
  /** Stripe is configured: paid plans go through Checkout. */
  cardPayments: boolean;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">(state.billingInterval);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(code: string) {
    setBusy(code);
    setError(null);
    startTransition(async () => {
      const result = await choosePlan({ code, interval });
      if (!result.ok) {
        setError(result.error);
      } else if ("url" in result) {
        window.location.assign(result.url);
        return;
      }
      router.refresh();
      setBusy(null);
    });
  }

  const plans = state.plans.filter((plan) => plan.code !== "TRIAL");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.375rem] font-bold tracking-tight">Find the plan that fits your firm</h1>
          <p className="mt-1 text-sm text-ink-2">Choose the plan that matches your work today. Upgrade any time as you grow.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs font-semibold text-accent">Save up to 25% with yearly billing</span>
          <div role="group" aria-label="Billing interval" className="inline-flex h-11 items-center gap-1 rounded-full border border-rule bg-surface p-1 shadow-xs">
            {(["YEARLY", "MONTHLY"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
                className={cx(
                  "inline-flex h-full items-center rounded-full px-5 text-sm font-semibold transition-colors",
                  interval === value ? "bg-accent text-white shadow-glow" : "text-ink-2 hover:text-ink",
                )}
              >
                {value === "YEARLY" ? "Yearly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <Alert tone="negative">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const current = plan.code === state.current.code && interval === state.billingInterval;
          const price = interval === "YEARLY" ? plan.yearlyMonthlyCents : plan.monthlyCents;
          const lifted = plan.highlighted === true;
          return (
            <div key={plan.code} className={cx("card flex flex-col overflow-hidden", lifted && "ring-2 ring-accent/60")}>
              <div className={cx("p-5", lifted ? "bg-accent-gradient text-white" : "")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-bold">{plan.name}</p>
                  {current ? <Badge tone={lifted ? "outline" : "accent"} className={lifted ? "border-white/40 text-white" : undefined}>Current</Badge> : null}
                </div>
                <p className={cx("mt-0.5 text-sm", lifted ? "text-white/80" : "text-ink-2")}>{plan.tagline}</p>
                <p className="mt-4">
                  <span className="figure text-3xl font-bold">{price === 0 ? "Free" : money(price).replace(/\.00$/, "")}</span>
                  {price > 0 ? <span className={cx("text-sm", lifted ? "text-white/80" : "text-ink-3")}>/Month</span> : null}
                </p>
                <p className={cx("mt-0.5 text-xs", lifted ? "text-white/70" : "text-ink-3")}>
                  {price > 0 ? (interval === "YEARLY" ? "Billed yearly" : "Billed monthly") : "No card needed"}
                </p>
                <Button
                  className={cx("mt-4 w-full rounded-full", lifted && "border-white bg-white text-accent-ink shadow-none hover:brightness-95")}
                  variant={current ? "secondary" : "primary"}
                  disabled={current || !canManage || pending}
                  onClick={() => choose(plan.code)}
                >
                  {current ? "Current plan" : busy === plan.code ? "Saving…" : "Subscribe"}
                </Button>
              </div>
              <div className="flex flex-1 flex-col p-5 pt-4">
                <div className="rounded-2xl bg-accent-soft/70 px-4 py-3">
                  <p className="figure text-lg font-bold text-accent-ink">{plan.allowancePerYear.toLocaleString("en-AU")}</p>
                  <p className="text-xs text-ink-2">Reconciled transactions / year</p>
                </div>
                <ul className="mt-4 flex flex-col gap-2 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Icon name="check-circle" className="mt-0.5 size-4 shrink-0 text-positive" />
                      <span className="text-ink">{feature}</span>
                    </li>
                  ))}
                  {plan.excludes.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Icon name="x-circle" className="mt-0.5 size-4 shrink-0 text-negative" />
                      <span className="text-ink-2">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-3">
          {cardPayments
            ? "Prices include GST. Paid plans go through secure card checkout; the plan changes once payment is confirmed."
            : "Prices are indicative and include GST. Choosing a plan records the choice for the firm; card collection and invoices arrive once checkout is configured, and nothing is charged until then."}
          {canManage ? "" : " Only an owner or admin can change the plan."}
        </p>
        {cardPayments && canManage ? (
          <Button
            variant="secondary"
            size="sm"
            icon="credit-card"
            className="rounded-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await openBillingPortal();
                if (result.ok) window.location.assign(result.url);
                else setError(result.error);
              })
            }
          >
            Invoices and card
          </Button>
        ) : null}
      </div>
    </div>
  );
}

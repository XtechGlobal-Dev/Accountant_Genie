import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { getBillingState } from "@/server/modules/billing/service";
import { stripeConfigured } from "@/server/modules/billing/stripe";
import { shortDate } from "@/shared/format";
import { PlanPicker } from "@/features/settings/components/plan-picker";
import { Alert, Badge, Card, CardHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Manage subscription" };

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await requireSession();
  const { checkout } = await searchParams;
  const state = await getBillingState(session.firmId);
  if (!state) notFound();

  const allowance = state.current.allowancePerYear;
  const usedPct = allowance > 0 ? Math.min(100, Math.round((state.used / allowance) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      {checkout === "success" ? (
        <Alert tone="positive" title="Payment received">
          The plan updates as soon as the payment confirmation arrives — usually within a few seconds.
        </Alert>
      ) : checkout === "cancelled" ? (
        <Alert tone="info">Checkout was cancelled. Nothing changed.</Alert>
      ) : null}

      <PlanPicker state={state} canManage={can(session, "billing:manage")} cardPayments={stripeConfigured()} />

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Current plan: {state.current.name}
              <Badge tone="outline">{state.billingInterval === "YEARLY" ? "Yearly" : "Monthly"}</Badge>
            </span>
          }
          description={state.planChangedAt ? `Chosen ${shortDate(state.planChangedAt)}. Usage is counted in reconciled bank transactions.` : "Usage is counted in reconciled bank transactions."}
        />
        <div className="px-6 py-5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-ink-2">Transactions used this year</span>
            <span className="figure font-semibold">
              {state.used.toLocaleString("en-AU")} of {allowance.toLocaleString("en-AU")}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(usedPct, 1)}%` }} />
          </div>
          <p className="figure mt-2 text-xs text-ink-3">
            {usedPct}% used · {state.remaining.toLocaleString("en-AU")} remaining · {state.clientCount.toLocaleString("en-AU")} active clients
          </p>
        </div>
      </Card>
    </div>
  );
}

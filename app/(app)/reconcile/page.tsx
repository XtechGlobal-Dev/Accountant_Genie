import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/core/session";
import { getFirmQueue } from "@/server/modules/firms/service";
import { ReconcileList } from "@/features/reconcile/components/reconcile-list";
import { Icon } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Alert, EmptyState, PageHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Reconciliation" };

/**
 * Firm-wide reconciliation: run the engine per client, see what it left for
 * a person. The engine codes; it never posts — accepting is done in review.
 */
export default async function ReconcilePage() {
  const { firmId } = await requireSession();
  const queue = await getFirmQueue(firmId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="AI"
        title="Reconciliation"
        context="Coding Memory first, then deterministic rules, then AI behind a validation gate. Anything uncertain goes to review instead of being guessed."
        action={
          <>
            <Link href="/memory" className={buttonClass({ variant: "secondary" })}>
              <Icon name="wand" />
              Coding Memory
            </Link>
            <Link href="/transactions" className={buttonClass({ variant: "secondary" })}>
              <Icon name="receipt" />
              Review queue
            </Link>
          </>
        }
      />

      <Alert tone="info" title="What a run does">
        Every uncoded transaction of the client is proposed an account and GST treatment, with a confidence and a
        risk score. Nothing reaches the ledger until a person accepts it on the Transactions screen.
      </Alert>

      {queue.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="Nothing to reconcile yet"
          body="Upload a bank statement for a client and the engine will have something to code."
          action={
            <Link href="/clients" className={buttonClass()}>
              <Icon name="users" />
              Open clients
            </Link>
          }
        />
      ) : (
        <ReconcileList rows={queue} />
      )}
    </div>
  );
}

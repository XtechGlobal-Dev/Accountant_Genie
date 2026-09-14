import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/core/session";
import { getFirmQueue } from "@/server/modules/firms/service";
import { Icon } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/ui/primitives";

export const metadata: Metadata = { title: "Transactions" };

/**
 * The firm-wide review queue: every active client and how many of its
 * transactions are waiting on a person. Reviewing happens inside the
 * client's workspace, where the ledger context is; this screen decides
 * where to go first.
 */
export default async function FirmTransactionsPage() {
  const { firmId } = await requireSession();
  const queue = await getFirmQueue(firmId);

  const totals = queue.reduce(
    (sum, row) => ({
      notCoded: sum.notCoded + row.notCoded,
      awaiting: sum.awaiting + row.awaitingReview,
      reviewed: sum.reviewed + row.reviewed,
    }),
    { notCoded: 0, awaiting: 0, reviewed: 0 },
  );
  const waiting = queue.filter((row) => row.awaitingReview + row.notCoded > 0);
  const clear = queue.filter((row) => row.awaitingReview + row.notCoded === 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        context="Where every client's bank transactions stand. Open a client to review its exceptions; accepting posts the journal."
        action={
          <Link href="/reconcile" className={buttonClass({ variant: "secondary" })}>
            <Icon name="sparkles" />
            Reconciliation
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting review" value={totals.awaiting.toLocaleString("en-AU")} icon="clock" tone="warning" hint="Coded by the engine, not yet signed off" />
        <StatCard label="Not yet coded" value={totals.notCoded.toLocaleString("en-AU")} icon="inbox" tone="accent" hint="Imported, waiting on reconciliation" />
        <StatCard label="Accepted" value={totals.reviewed.toLocaleString("en-AU")} icon="check-circle" tone="positive" hint="Signed off and posted to the ledger" />
      </div>

      {queue.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No transactions yet"
          body="Add a client and upload a bank statement. Coding and review start from there."
          action={
            <Link href="/clients?new=1" className={buttonClass()}>
              <Icon name="user-plus" />
              Add a client
            </Link>
          }
        />
      ) : (
        <Card>
          <CardHeader title="By client" description={waiting.length > 0 ? `${waiting.length} client${waiting.length === 1 ? "" : "s"} with work waiting.` : "Every client is up to date."} />
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-36 text-right">Not coded</th>
                <th className="w-36 text-right">Awaiting review</th>
                <th className="w-32 text-right">Accepted</th>
                <th className="w-36">Status</th>
                <th className="w-40 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...waiting, ...clear].map((row) => (
                <tr key={row.clientId}>
                  <td>
                    <Link href={`/clients/${row.clientId}`} className="flex items-center gap-2.5 font-semibold text-ink hover:text-accent">
                      <Avatar name={row.name} size="md" />
                      {row.name}
                    </Link>
                  </td>
                  <td className="figure text-right text-ink-2">{row.notCoded.toLocaleString("en-AU")}</td>
                  <td className="figure text-right text-ink-2">{row.awaitingReview.toLocaleString("en-AU")}</td>
                  <td className="figure text-right text-ink-2">{row.reviewed.toLocaleString("en-AU")}</td>
                  <td>
                    {row.awaitingReview + row.notCoded > 0 ? (
                      <Badge tone="warning" dot>
                        {(row.awaitingReview + row.notCoded).toLocaleString("en-AU")} waiting
                      </Badge>
                    ) : (
                      <Badge tone="positive" dot>
                        Up to date
                      </Badge>
                    )}
                  </td>
                  <td className="text-right">
                    <Link href={`/clients/${row.clientId}/transactions`} className={buttonClass({ variant: row.awaitingReview + row.notCoded > 0 ? "primary" : "secondary", size: "sm" })}>
                      {row.awaitingReview + row.notCoded > 0 ? "Review" : "Open"}
                      <Icon name="arrow-right" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

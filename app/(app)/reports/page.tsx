import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/core/session";
import { listClientOptions } from "@/server/modules/clients/service";
import { Icon, type IconName } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Avatar, Card, CardHeader, EmptyState, PageHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Reports" };

const REPORTS: ReadonlyArray<{ href: string; icon: IconName; title: string; body: string }> = [
  { href: "profit-and-loss", icon: "trending-down", title: "Profit & Loss", body: "Income and expenses for a period." },
  { href: "balance-sheet", icon: "scale", title: "Balance Sheet", body: "Assets, liabilities and equity as at a date." },
  { href: "trial-balance", icon: "table", title: "Trial Balance", body: "Every account's debit and credit total." },
  { href: "general-ledger", icon: "book-open", title: "General Ledger", body: "Every journal line, by account." },
  { href: "bas", icon: "calculator", title: "Business Activity Statement", body: "G1, G10, G11, 1A, 1B, W1, W2 with lineage." },
  { href: "transactions", icon: "receipt", title: "Transactions", body: "Bank transactions with their coding." },
  { href: "depreciation", icon: "briefcase", title: "Depreciation Schedule", body: "Decline in value of each asset." },
  { href: "tpar", icon: "hard-hat", title: "TPAR", body: "Payments to subcontractors for the year." },
  { href: "eofy", icon: "file-text", title: "EOFY", body: "The year-end pack, ready to hand over." },
];

/**
 * Reports across the firm: pick a client, pick a report. Every report
 * derives from that client's ledger; nothing is computed here.
 */
export default async function FirmReportsPage() {
  const { firmId } = await requireSession();
  const clients = await listClientOptions(firmId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        context="One reporting layer over each client's ledger. Every figure drills down to the journal lines behind it; print, save as PDF or export CSV from any report."
      />

      {clients.length === 0 ? (
        <EmptyState
          icon="bar-chart"
          title="No clients yet"
          body="Reports are per client. Add one and its ledger starts the moment a transaction is accepted."
          action={
            <Link href="/clients?new=1" className={buttonClass()}>
              <Icon name="user-plus" />
              Add a client
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[2fr_3fr]">
          <Card>
            <CardHeader title="Clients" description="Open a client's full report list." />
            <ul className="divide-y divide-rule-soft">
              {clients.map((client) => (
                <li key={client.id}>
                  <Link href={`/clients/${client.id}/reports`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken">
                    <Avatar name={client.businessName} size="md" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{client.businessName}</span>
                    <Icon name="chevron-right" className="size-4 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Report types" description="Each opens for the first client; switch clients from the workspace." />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {REPORTS.map((report) => (
                <Link
                  key={report.href}
                  href={`/clients/${clients[0]?.id}/reports/${report.href}`}
                  className="group flex items-start gap-3 rounded-2xl border border-rule bg-surface-2 p-4 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                    <Icon name={report.icon} className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{report.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">{report.body}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

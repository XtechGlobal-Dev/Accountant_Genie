import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/core/session";
import { getDashboard } from "@/server/modules/firms/service";
import { currentFinancialYear, financialYearRange, quarterOf } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { IMPORT_STATUS_LABELS } from "@/shared/labels";
import { FyTimeline } from "@/features/home/components/fy-timeline";
import { ActivityChart } from "@/features/home/components/activity-chart";
import { Icon } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Avatar, Badge, Card, CardHeader, StatCard } from "@/ui/primitives";

export const metadata: Metadata = { title: "Home" };

/**
 * The firm's home: a welcome, where the year stands, and then where the work
 * stands across every client. Every figure is a count of rows the firm owns;
 * nothing is derived from the ledger here.
 */

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hour12: false, timeZone: "Australia/Sydney" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const { firmId, userName } = await requireSession();
  const dashboard = await getDashboard(firmId);

  const now = new Date();
  const fy = currentFinancialYear(now);
  const range = financialYearRange(fy);
  const elapsedPct = ((now.getTime() - range.start.getTime()) / (range.end.getTime() - range.start.getTime())) * 100;
  const firstName = userName.split(/\s+/)[0] ?? userName;
  const { clients, transactions, journalCount, recentImports, queue, monthly } = dashboard;
  const coded = Math.max(0, transactions.total - transactions.awaitingReview - transactions.notCoded);

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 pt-8 text-center">
        <div>
          <h1 className="display text-[2rem] lg:text-[2.25rem]">
            {greeting(now)}, {firstName}
          </h1>
          <p className="mt-2 text-[15px] text-ink-2">Continue reconciling client transactions, reviewing files, and preparing reports.</p>
        </div>
        <div className="w-full">
          <FyTimeline fy={fy} start={range.start} end={range.end} today={now} quarter={quarterOf(now)} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/help" className={buttonClass({ className: "rounded-full" })}>
            <Icon name="play" />
            Tutorials
          </Link>
          <Link href="/help" className={buttonClass({ variant: "secondary", className: "rounded-full" })}>
            <Icon name="info" />
            Help Docs
          </Link>
          {clients.active === 0 ? (
            <Link href="/clients?new=1" className={buttonClass({ variant: "secondary", className: "rounded-full" })}>
              <Icon name="user-plus" />
              Add your first client
            </Link>
          ) : null}
        </div>
      </section>

      {/* Where the work stands */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active clients" value={clients.active.toLocaleString("en-AU")} icon="users" tone="accent" href="/clients" hint={clients.archived > 0 ? `${clients.archived.toLocaleString("en-AU")} archived` : "Every client holds its own ledger"} />
        <StatCard label="Awaiting review" value={transactions.awaitingReview.toLocaleString("en-AU")} icon="clock" tone="warning" href="/transactions" hint="Coded by the engine, not yet signed off" />
        <StatCard label="Not yet coded" value={transactions.notCoded.toLocaleString("en-AU")} icon="inbox" tone="accent" href="/reconcile" hint="Imported, waiting on reconciliation" />
        <StatCard label="Journals posted" value={journalCount.toLocaleString("en-AU")} icon="book-open" tone="positive" href="/reports" hint="Across every client's ledger" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[13fr_7fr]">
        <ActivityChart fy={fy} months={monthly} elapsedPct={elapsedPct} quarter={quarterOf(now)} />

        <Card className="flex flex-col">
          <CardHeader title="Work queue" description="Every transaction the firm holds, by state." />
          <ul className="flex flex-col divide-y divide-rule-soft px-3 py-1">
            {[
              { label: "Coded & accepted", count: coded, color: "bg-positive", href: "/transactions" },
              { label: "Awaiting review", count: transactions.awaitingReview, color: "bg-warning", href: "/transactions" },
              { label: "Not yet coded", count: transactions.notCoded, color: "bg-accent", href: "/reconcile" },
            ].map((row) => (
              <li key={row.label}>
                <Link href={row.href} className="group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-sunken">
                  <span className={`size-2.5 rounded-full ${row.color}`} />
                  <span className="flex-1 text-sm font-medium text-ink-2 group-hover:text-ink">{row.label}</span>
                  <span className="figure text-sm font-bold">{row.count.toLocaleString("en-AU")}</span>
                  <Icon name="chevron-right" className="size-4 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto border-t border-rule px-6 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">By client</p>
            {queue.length === 0 ? (
              <p className="mt-2 text-sm text-ink-2">No transactions yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {queue.slice(0, 4).map((row) => (
                  <li key={row.clientId}>
                    <Link href={`/clients/${row.clientId}/transactions`} className="flex items-center gap-3 text-sm hover:text-accent">
                      <Avatar name={row.name} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                      {row.awaitingReview + row.notCoded > 0 ? (
                        <Badge tone="warning">{(row.awaitingReview + row.notCoded).toLocaleString("en-AU")} waiting</Badge>
                      ) : (
                        <Badge tone="positive">Up to date</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent imports"
          description="The latest statements to arrive, across the firm."
          action={
            <Link href="/clients" className={buttonClass({ variant: "secondary", size: "sm", className: "rounded-full" })}>
              All clients
              <Icon name="arrow-right" />
            </Link>
          }
        />
        {recentImports.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="upload" className="size-6" />
            </span>
            <p className="text-base font-bold">Nothing imported yet</p>
            <p className="max-w-xs text-sm text-ink-2">Open a client and upload a bank file. Dedup, coding and review run on their own.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th className="w-32">Date</th>
                  <th>Client</th>
                  <th>Source</th>
                  <th className="w-28 text-right">Rows</th>
                  <th className="w-32">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentImports.map((row) => (
                  <tr key={row.id}>
                    <td className="figure text-ink-2">{shortDate(row.createdAt)}</td>
                    <td>
                      <Link href={`/clients/${row.clientId}`} className="flex items-center gap-2.5 font-semibold text-ink hover:text-accent">
                        <Avatar name={row.clientName} size="md" />
                        <span className="truncate">{row.clientName}</span>
                      </Link>
                    </td>
                    <td className="text-ink-2">{row.bankAccountName}</td>
                    <td className="figure text-right text-ink-2">{row.rowCount.toLocaleString("en-AU")}</td>
                    <td>
                      <Badge tone={row.status === "FAILED" ? "negative" : row.status === "COMPLETE" ? "positive" : "warning"}>{IMPORT_STATUS_LABELS[row.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

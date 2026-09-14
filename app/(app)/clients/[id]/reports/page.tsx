import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { Icon, type IconName } from "@/ui/icons";

export const metadata: Metadata = { title: "Reports" };

/**
 * Every report derives from the one ledger. The registers — assets,
 * subcontractors, loans — feed the three specialist reports; a client with no
 * subcontractors recorded simply has no TPAR.
 */

const REPORTS: ReadonlyArray<{ href: string; icon: IconName; title: string; body: string; group: string }> = [
  { group: "Financial statements", href: "profit-and-loss", icon: "bar-chart", title: "Profit & Loss", body: "Income, direct costs and expenses for a year, quarter or month, net of GST." },
  { group: "Financial statements", href: "balance-sheet", icon: "scale", title: "Balance Sheet", body: "Assets, liabilities and equity as at a date, with the GST control and earnings." },
  { group: "Financial statements", href: "trial-balance", icon: "list-checks", title: "Trial Balance", body: "Closing balance of every account, debits against credits." },
  { group: "Financial statements", href: "general-ledger", icon: "book-open", title: "General Ledger", body: "Every movement on every account in the period, with running balances." },
  { group: "Tax", href: "bas", icon: "calculator", title: "Business Activity Statement", body: "Simple BAS labels for a period, each traceable to the lines behind it." },
  { group: "Tax", href: "transactions", icon: "receipt", title: "Transactions", body: "Every bank transaction in the period and how it was coded." },
  { group: "Tax", href: "tpar", icon: "hard-hat", title: "Taxable Payments Annual Report", body: "Payments to each subcontractor for the year. Needs the subcontractor register." },
  { group: "Year end", href: "depreciation", icon: "trending-down", title: "Depreciation Schedule", body: "Decline in value of each asset for the year. Needs the asset register." },
  { group: "Year end", href: "eofy", icon: "file-text", title: "End of Financial Year Statement", body: "The year-end pack: statements, depreciation, loans and partner shares in one place." },
];

export default async function ReportsIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();
  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const groups = [...new Set(REPORTS.map((r) => r.group))];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] text-ink-2">
        One reporting layer over the ledger. A figure here and a figure on the BAS are the same sum,
        never two calculations.
      </p>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-2">{group}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {REPORTS.filter((r) => r.group === group).map((report) => (
              <Link
                key={report.href}
                href={`/clients/${id}/reports/${report.href}`}
                className="card flex items-start gap-4 p-5 transition-shadow hover:shadow-card-hover"
              >
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-gradient text-white shadow-glow">
                  <Icon name={report.icon} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-base font-semibold">
                    {report.title}
                    <Icon name="arrow-right" className="size-4 text-ink-3" />
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-2">{report.body}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

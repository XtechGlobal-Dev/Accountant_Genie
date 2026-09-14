import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { asAtOf, getTransactionsReport } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { GST_TREATMENT_LABELS } from "@/shared/labels";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Badge, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Transactions Report" };

export default async function TransactionsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fy?: string; q?: string; m?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { firmId } = await requireSession();
  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const period = resolvePeriod(query);
  const rows = await getTransactionsReport(firmId, client.id, period);
  if (!rows) notFound();

  const included = rows.filter((row) => !row.excludedAt);
  const totalIn = included.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0);
  const totalOut = included.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0);
  const totalGst = included.reduce((s, r) => s + r.gstCents, 0);

  return (
    <ReportFrame
      clientId={id}
      picker={<PeriodPicker basePath={`/clients/${id}/reports/transactions`} period={period} financialYears={recentFinancialYears(6)} />}
      title="Transactions"
      subtitle={
        <>
          {client.businessName} · {period.label} ·{" "}
          <span className="figure">
            {shortDate(period.start)} — {shortDate(asAtOf(period))}
          </span>{" "}
          · every bank transaction in the period and how it was coded
        </>
      }
      footnote="Amounts are as they appeared on the statement. GST is what the engine computed from the tax code; a dash means none applies. Excluded rows are listed but left out of the totals."
    >
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-2">No bank transactions dated in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[60rem]">
            <thead>
              <tr>
                <th className="w-28">Date</th>
                <th>Description</th>
                <th className="w-40">Bank account</th>
                <th className="w-56">Account</th>
                <th className="w-32">Tax code</th>
                <th className="w-32 text-right">Amount</th>
                <th className="w-28 text-right">GST</th>
                <th className="w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.excludedAt ? "opacity-60" : undefined}>
                  <td className="figure text-ink-2">{shortDate(row.date)}</td>
                  <td className="max-w-[24rem] truncate" title={row.description}>
                    {row.journalEntryId ? (
                      <Link href={`/clients/${id}/journals/${row.journalEntryId}`} className="hover:text-accent">
                        {row.description}
                      </Link>
                    ) : (
                      row.description
                    )}
                  </td>
                  <td className="text-ink-2">{row.bankAccountName}</td>
                  <td>
                    {row.accountCode !== null ? (
                      <>
                        <span className="code mr-1.5 text-ink-3">{row.accountCode}</span>
                        {row.accountName}
                      </>
                    ) : (
                      <span className="text-ink-3">Not coded</span>
                    )}
                  </td>
                  <td className="text-ink-2">{row.gstTreatment ? GST_TREATMENT_LABELS[row.gstTreatment] : "—"}</td>
                  <td className="text-right">
                    <Money cents={row.amountCents} />
                  </td>
                  <td className="text-right">{row.gstCents !== 0 ? <Money cents={row.gstCents} /> : <span className="text-ink-3">—</span>}</td>
                  <td>
                    {row.excludedAt ? (
                      <Badge tone="neutral">Excluded</Badge>
                    ) : row.status === "REVIEWED" ? (
                      <Badge tone="positive">Accepted</Badge>
                    ) : row.status === "CLASSIFIED" ? (
                      <Badge tone={row.needsReview ? "warning" : "accent"}>{row.needsReview ? "Review" : "Ready"}</Badge>
                    ) : (
                      <Badge tone="outline">Not coded</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>
                  Money in <Money cents={totalIn} className="ml-2" /> · Money out <Money cents={totalOut} className="ml-2" />
                </td>
                <td className="text-right">
                  <Money cents={totalIn + totalOut} emphasis />
                </td>
                <td className="text-right">
                  <Money cents={totalGst} emphasis />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportFrame>
  );
}

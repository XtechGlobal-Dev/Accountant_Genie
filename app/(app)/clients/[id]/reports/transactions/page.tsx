import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { asAtOf, getTransactionsReport } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { ACCOUNT_TYPE_LABELS } from "@/shared/labels";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Icon } from "@/ui/icons";
import { Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Transactions Report" };

/**
 * Count, gross, GST and net per account from bank transactions in the period.
 *
 * Built from journal lines like every other report: a bank row that has not
 * been accepted has no journal and is not here, so these figures agree with
 * the P&L and the BAS for the same period. To see uncoded or unaccepted rows,
 * use the client's Transactions review screen.
 */
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
  const report = await getTransactionsReport(firmId, client.id, period);
  if (!report) notFound();

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
          · accepted bank transactions, summed per account
        </>
      }
      footnote={`Built from ${report.lineCount.toLocaleString("en-AU")} posted journal lines; the bank side of each posting is left out. Gross is GST inclusive from the account's natural side; net is gross less the GST the posting engine computed. Transactions not yet accepted have no journal and are not counted — review them on the Transactions screen.`}
    >
      {report.accounts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-2">
          No accepted bank transactions dated in this period.{" "}
          <Link href={`/clients/${id}/transactions`} className="text-accent hover:underline">
            Open the review screen
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[52rem]">
            <thead>
              <tr>
                <th className="w-24">Code</th>
                <th>Account</th>
                <th className="w-28">Type</th>
                <th className="w-20 text-right">Count</th>
                <th className="w-32 text-right">Gross</th>
                <th className="w-28 text-right">GST</th>
                <th className="w-32 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((row) => (
                <tr key={row.accountId}>
                  <td className="code text-ink-3">{row.code}</td>
                  <td>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
                        {row.name}
                        <Icon name="chevron-down" className="size-3.5 text-ink-3 transition-transform group-open:rotate-180" />
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
                        {row.contributors.map((line, index) => (
                          <li key={`${line.entryId}-${index}`} className="flex items-center gap-3">
                            <span className="figure w-20 shrink-0 text-ink-3">{shortDate(line.date)}</span>
                            <Link href={`/clients/${id}/journals/${line.entryId}`} className="min-w-0 flex-1 truncate hover:text-accent">
                              {line.description ?? "Journal entry"}
                            </Link>
                            <Money cents={line.cents} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="text-ink-2">{ACCOUNT_TYPE_LABELS[row.type]}</td>
                  <td className="figure text-right">{row.count}</td>
                  <td className="text-right">
                    <Money cents={row.grossCents} />
                  </td>
                  <td className="text-right">{row.gstCents !== 0 ? <Money cents={row.gstCents} /> : <span className="text-ink-3">—</span>}</td>
                  <td className="text-right">
                    <Money cents={row.netCents} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="figure text-right">{report.totalCount}</td>
                <td className="text-right">
                  <Money cents={report.totalGrossCents} emphasis />
                </td>
                <td className="text-right">
                  <Money cents={report.totalGstCents} emphasis />
                </td>
                <td className="text-right">
                  <Money cents={report.totalNetCents} emphasis />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportFrame>
  );
}

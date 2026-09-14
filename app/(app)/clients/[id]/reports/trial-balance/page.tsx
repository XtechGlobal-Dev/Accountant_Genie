import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { asAtOf, getTrialBalance } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Alert, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Trial Balance" };

export default async function TrialBalancePage({
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
  const report = await getTrialBalance(firmId, client.id, period);
  if (!report) notFound();

  return (
    <ReportFrame
      clientId={id}
      picker={<PeriodPicker basePath={`/clients/${id}/reports/trial-balance`} period={period} financialYears={recentFinancialYears(6)} />}
      title="Trial Balance"
      subtitle={
        <>
          {client.businessName} · as at <span className="figure">{shortDate(asAtOf(period))}</span> · closing balances on gross postings
        </>
      }
      footnote={`Built from ${report.lineCount.toLocaleString("en-AU")} journal lines from the start of the ledger. Debits and credits must be equal: every journal balanced, so the ledger balances.`}
    >
      {report.differenceCents !== 0 ? (
        <div className="px-5 pt-4">
          <Alert tone="negative" title="The trial balance does not sum to zero">
            Debits exceed credits by <Money cents={report.differenceCents} />. A posted journal is unbalanced.
          </Alert>
        </div>
      ) : null}
      {report.lines.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-2">Nothing posted before this date.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="w-20">Code</th>
              <th>Account</th>
              <th className="w-40 text-right">Debit</th>
              <th className="w-40 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((row) => (
              <tr key={row.accountId}>
                <td className="code text-ink-2">{row.code}</td>
                <td>{row.name}</td>
                <td className="text-right">{row.debitCents > 0 ? <Money cents={row.debitCents} /> : <span className="text-ink-3">—</span>}</td>
                <td className="text-right">{row.creditCents > 0 ? <Money cents={row.creditCents} /> : <span className="text-ink-3">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Totals</td>
              <td className="text-right">
                <Money cents={report.totalDebitCents} emphasis />
              </td>
              <td className="text-right">
                <Money cents={report.totalCreditCents} emphasis />
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </ReportFrame>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { asAtOf, getBalanceSheet } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import type { ReportLine } from "@/shared/contracts/report";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Alert, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Balance Sheet" };

function Rows({ rows }: { rows: ReportLine[] }) {
  return rows.length === 0 ? (
    <tr>
      <td colSpan={3} className="text-ink-3">
        Nothing posted
      </td>
    </tr>
  ) : (
    <>
      {rows.map((row) => (
        <tr key={row.accountId}>
          <td className="code w-20 text-ink-2">{row.code}</td>
          <td>{row.name}</td>
          <td className="w-40 text-right">
            <Money cents={row.cents} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <tr>
      <td colSpan={2} className={strong ? "bg-surface-2 text-base font-semibold" : "font-semibold"}>
        {label}
      </td>
      <td className={strong ? "bg-surface-2 text-right" : "text-right"}>
        <Money cents={cents} emphasis />
      </td>
    </tr>
  );
}

export default async function BalanceSheetPage({
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
  const report = await getBalanceSheet(firmId, client.id, period);
  if (!report) notFound();

  return (
    <ReportFrame
      clientId={id}
      picker={<PeriodPicker basePath={`/clients/${id}/reports/balance-sheet`} period={period} financialYears={recentFinancialYears(6)} />}
      title="Balance Sheet"
      subtitle={
        <>
          {client.businessName} · as at <span className="figure">{shortDate(asAtOf(period))}</span>
        </>
      }
      footnote={`Built from ${report.lineCount.toLocaleString("en-AU")} journal lines from the start of the ledger. Assets are net of the GST claimed on them; the GST control is the net of GST collected and claimed on every posted line.`}
    >
      {report.differenceCents !== 0 ? (
        <div className="px-5 pt-4">
          <Alert tone="negative" title="This balance sheet does not balance">
            Assets differ from liabilities plus equity by <Money cents={report.differenceCents} />. A posted journal
            is unbalanced — that is a defect, not a rounding matter.
          </Alert>
        </div>
      ) : null}
      <table>
        <tbody>
          <tr>
            <th className="group-row" colSpan={3}>Assets</th>
          </tr>
          <Rows rows={report.assets} />
          <Total label="Total assets" cents={report.totalAssetsCents} strong />

          <tr>
            <th className="group-row" colSpan={3}>Liabilities</th>
          </tr>
          <Rows rows={report.liabilities} />
          <tr>
            <td className="code w-20 text-ink-2">—</td>
            <td>GST control (net owed to the ATO)</td>
            <td className="text-right">
              <Money cents={report.gstControlCents} />
            </td>
          </tr>
          <Total label="Total liabilities" cents={report.totalLiabilitiesCents} strong />

          <tr>
            <th className="group-row" colSpan={3}>Equity</th>
          </tr>
          <Rows rows={report.equity} />
          <tr>
            <td className="code w-20 text-ink-2">—</td>
            <td>Retained earnings (prior years)</td>
            <td className="text-right">
              <Money cents={report.retainedEarningsCents} />
            </td>
          </tr>
          <tr>
            <td className="code w-20 text-ink-2">—</td>
            <td>Current year earnings</td>
            <td className="text-right">
              <Money cents={report.currentEarningsCents} />
            </td>
          </tr>
          <Total label="Total equity" cents={report.totalEquityCents} strong />
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Liabilities and equity</td>
            <td className="text-right">
              <Money cents={report.totalLiabilitiesCents + report.totalEquityCents} emphasis />
            </td>
          </tr>
        </tfoot>
      </table>
    </ReportFrame>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { getProfitAndLoss } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import type { ReportLine } from "@/shared/contracts/report";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ButtonLink, EmptyState, Money } from "@/ui/primitives";
import { ReportActions } from "@/features/reports/components/report-actions";

export const metadata: Metadata = { title: "Profit & Loss" };

function Section({
  title,
  rows,
  totalLabel,
  totalCents,
}: {
  title: string;
  rows: ReportLine[];
  totalLabel: string;
  totalCents: number;
}) {
  return (
    <>
      <tr>
        <th className="group-row" colSpan={3}>
          {title}
        </th>
      </tr>
      {rows.length === 0 ? (
        <tr>
          <td colSpan={3} className="text-ink-3">
            Nothing posted
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <tr key={row.accountId}>
            <td className="code w-20 text-ink-2">{row.code}</td>
            <td>{row.name}</td>
            <td className="w-40 text-right">
              <Money cents={row.cents} />
            </td>
          </tr>
        ))
      )}
      <tr>
        <td colSpan={2} className="font-semibold">
          {totalLabel}
        </td>
        <td className="text-right">
          <Money cents={totalCents} emphasis />
        </td>
      </tr>
    </>
  );
}

export default async function ProfitAndLossPage({
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
  const report = await getProfitAndLoss(firmId, client.id, period);
  if (!report) notFound();

  const basePath = `/clients/${id}/reports/profit-and-loss`;
  const lastDay = new Date(period.end.getTime() - 86_400_000);

  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker basePath={basePath} period={period} financialYears={recentFinancialYears(6)} />
        <span className="flex flex-wrap items-center gap-2">
          <ReportActions filename="profit-and-loss" />
          <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/reports`}>
            All reports
          </ButtonLink>
        </span>
      </div>

      <div className="sheet">
        <div className="border-b border-rule px-5 py-4">
          <h2 className="display text-[1.625rem]">Profit &amp; Loss</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {client.businessName} · {period.label} ·{" "}
            <span className="figure">
              {shortDate(period.start)} — {shortDate(lastDay)}
            </span>
            {client.gstRegistered ? " · amounts exclude GST" : " · not registered for GST"}
          </p>
        </div>

        {report.lineCount === 0 ? (
          <EmptyState
            icon="bar-chart"
            title="Nothing posted in this period"
            body="Journal lines dated inside the period feed this report. Post a journal, or pick another period."
            className="m-5"
            action={
              <ButtonLink href={`/clients/${id}/journals?new=1`} icon="plus">
                New journal
              </ButtonLink>
            }
          />
        ) : (
          <table>
            <tbody>
              <Section
                title="Income"
                rows={report.income}
                totalLabel="Total income"
                totalCents={report.totalIncomeCents}
              />
              <Section
                title="Direct costs"
                rows={report.cogs}
                totalLabel="Total direct costs"
                totalCents={report.totalCogsCents}
              />
              <tr>
                <td colSpan={2} className="bg-surface-2 font-semibold">
                  Gross profit
                </td>
                <td className="bg-surface-2 text-right">
                  <Money cents={report.grossProfitCents} emphasis />
                </td>
              </tr>
              <Section
                title="Expenses"
                rows={report.expenses}
                totalLabel="Total expenses"
                totalCents={report.totalExpensesCents}
              />
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="text-base">
                  Net profit
                </td>
                <td className="text-right text-base">
                  <Money cents={report.netProfitCents} emphasis />
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Built from {report.lineCount.toLocaleString("en-AU")} journal lines. Every figure is a sum of
        posted lines; nothing on this page does arithmetic of its own.
      </p>
    </div>
  );
}

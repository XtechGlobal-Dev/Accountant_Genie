import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { getTpar } from "@/server/modules/reports/service";
import { currentFinancialYear, recentFinancialYears } from "@/server/au/fy";
import { abn as formatAbn } from "@/shared/format";
import { FyPicker } from "@/features/reports/components/fy-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Alert, Badge, ButtonLink, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Taxable Payments Annual Report" };

function fyFrom(value: string | undefined): number {
  const current = currentFinancialYear();
  const fy = Number(value);
  return Number.isInteger(fy) && fy >= 2000 && fy <= current + 1 ? fy : current;
}

export default async function TparPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fy?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { firmId } = await requireSession();
  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const fy = fyFrom(query.fy);
  const report = await getTpar(firmId, client.id, fy);
  if (!report) notFound();

  const missingAbn = report.lines.filter((line) => !line.abn).length;

  return (
    <ReportFrame
      clientId={id}
      picker={<FyPicker basePath={`/clients/${id}/reports/tpar`} fy={fy} financialYears={recentFinancialYears(6)} />}
      title="Taxable Payments Annual Report"
      subtitle={<>{client.businessName} · FY{fy} · payments to subcontractors, gross including GST</>}
      footnote="Sums the journal lines posted to the subcontractor payments account and linked to a subcontractor. Prepared for review; not lodged from here."
    >
      <div className="px-5 pt-4">
        {report.mappingVerified ? (
          <Badge tone="positive" title="The reportable accounts have been verified by the registered tax advisor under Settings → Tax rules.">
            Verified mapping · accounts {report.accountCodes.join(", ")}
          </Badge>
        ) : (
          <Badge tone="warning" title="Sums the chart's Subcontractor Payments account. Which accounts are TPAR-reportable is to be confirmed by the registered tax advisor under Settings → Tax rules → TPAR accounts.">
            Verify mapping · accounts {report.accountCodes.join(", ")}
          </Badge>
        )}
      </div>
      {report.unlinkedCount > 0 ? (
        <div className="px-5 pt-4">
          <Alert
            tone="warning"
            title={`${report.unlinkedCount} subcontractor payment${report.unlinkedCount === 1 ? "" : "s"} not linked to anyone`}
            action={
              <ButtonLink variant="secondary" size="sm" href={`/clients/${id}/transactions`}>
                Link them
              </ButtonLink>
            }
          >
            <Money cents={report.unlinkedCents} /> posted to the subcontractor account has no subcontractor
            against it and is missing from this report. Recode those transactions and choose the
            subcontractor.
          </Alert>
        </div>
      ) : null}
      {report.lines.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-2">
          No linked subcontractor payments in FY{fy}.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Payee</th>
              <th className="w-44">ABN</th>
              <th className="w-24 text-right">Payments</th>
              <th className="w-40 text-right">Gross paid</th>
              <th className="w-32 text-right">GST</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.subcontractorId}>
                <td className="font-medium">{line.name}</td>
                <td className="figure text-ink-2">{line.abn ? formatAbn(line.abn) : <Badge tone="negative">Missing ABN</Badge>}</td>
                <td className="figure text-right text-ink-2">{line.paymentCount}</td>
                <td className="text-right">
                  <Money cents={line.grossCents} />
                </td>
                <td className="text-right">
                  <Money cents={line.gstCents} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                Total{missingAbn > 0 ? ` · ${missingAbn} payee${missingAbn === 1 ? "" : "s"} without an ABN` : ""}
              </td>
              <td className="text-right">
                <Money cents={report.totalGrossCents} emphasis />
              </td>
              <td className="text-right">
                <Money cents={report.totalGstCents} emphasis />
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </ReportFrame>
  );
}

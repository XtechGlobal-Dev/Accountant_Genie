import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getDepreciationSchedule, verifiedThresholds } from "@/server/modules/assets/service";
import { getClientHeader } from "@/server/modules/clients/service";
import { currentFinancialYear, recentFinancialYears } from "@/server/au/fy";
import { formatBasisPoints } from "@/shared/money";
import { FyPicker } from "@/features/reports/components/fy-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Alert, ButtonLink, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Depreciation Schedule" };

function fyFrom(value: string | undefined): number {
  const current = currentFinancialYear();
  const fy = Number(value);
  return Number.isInteger(fy) && fy >= 2000 && fy <= current + 1 ? fy : current;
}

export default async function DepreciationPage({
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
  const [schedule, thresholds] = await Promise.all([getDepreciationSchedule(firmId, client.id, fy), verifiedThresholds(firmId, fy)]);
  if (!schedule) notFound();

  return (
    <ReportFrame
      clientId={id}
      picker={<FyPicker basePath={`/clients/${id}/reports/depreciation`} fy={fy} financialYears={recentFinancialYears(6)} />}
      title="Depreciation Schedule"
      subtitle={<>{client.businessName} · FY{fy} · decline in value of each asset on the register</>}
      footnote="Prime cost: cost × days held ÷ days in year × (100% ÷ effective life). Diminishing value: opening value × days held ÷ days in year × (200% ÷ effective life). Private use reduces the deductible share. The instant asset write-off and car limit apply only from verified tax-rule versions; low-value pooling is not modelled."
    >
      <div className="px-5 pt-4">
        {thresholds.verified.writeOff && thresholds.verified.carLimit ? (
          <Alert tone="positive" title="Verified thresholds applied">
            Instant asset write-off up to <Money cents={thresholds.instantWriteOffCents ?? 0} /> and car limit{" "}
            <Money cents={thresholds.carLimitCents ?? 0} />, as verified under Settings → Tax rules.
          </Alert>
        ) : (
          <Alert tone="warning" title="Not every threshold is verified">
            {thresholds.verified.writeOff ? (
              <>Instant asset write-off is verified and applied. </>
            ) : (
              <>No verified instant asset write-off threshold — none is applied. </>
            )}
            {thresholds.verified.carLimit ? (
              <>The car limit is verified and applied.</>
            ) : (
              <>No verified car limit — none is applied.</>
            )}{" "}
            The registered tax advisor verifies these under Settings → Tax rules; until then the
            schedule uses the plain method only.
          </Alert>
        )}
        {!thresholds.verified.methods ? (
          <Alert tone="warning" title="Method rates not yet verified">
            The schedule is using the statutory rates (prime cost 100% ÷ life, diminishing value 200% ÷
            life for assets acquired after 10 May 2006). The registered tax advisor confirms them under
            Settings → Tax rules → Depreciation method rates. REQUIRES_VERIFICATION before this schedule
            is relied on.
          </Alert>
        ) : null}
      </div>
      {schedule.lines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-ink-2">No assets held in FY{fy}.</p>
          <ButtonLink variant="secondary" href={`/clients/${id}/assets`} icon="plus">
            Add an asset
          </ButtonLink>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[56rem]">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="w-28">Method</th>
                <th className="w-20 text-right">Days</th>
                <th className="w-32 text-right">Cost</th>
                <th className="w-32 text-right">Opening WDV</th>
                <th className="w-32 text-right">Decline</th>
                <th className="w-24 text-right">Private</th>
                <th className="w-32 text-right">Deductible</th>
                <th className="w-32 text-right">Closing WDV</th>
              </tr>
            </thead>
            <tbody>
              {schedule.lines.map((line) => (
                <tr key={line.assetId}>
                  <td className="font-medium">{line.name}</td>
                  <td className="text-ink-2">{line.method === "PRIME_COST" ? "Prime cost" : "Diminishing"}</td>
                  <td className="figure text-right text-ink-2">{line.daysHeld}</td>
                  <td className="text-right"><Money cents={line.costCents} /></td>
                  <td className="text-right"><Money cents={line.openingCents} /></td>
                  <td className="text-right"><Money cents={line.depreciationCents} /></td>
                  <td className="figure text-right text-ink-2">{formatBasisPoints(line.privateUseBasisPoints)}</td>
                  <td className="text-right"><Money cents={line.deductibleCents} /></td>
                  <td className="text-right"><Money cents={line.closingCents} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Totals</td>
                <td className="text-right"><Money cents={schedule.totalDepreciationCents} emphasis /></td>
                <td />
                <td className="text-right"><Money cents={schedule.totalDeductibleCents} emphasis /></td>
                <td className="text-right"><Money cents={schedule.totalClosingCents} emphasis /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportFrame>
  );
}

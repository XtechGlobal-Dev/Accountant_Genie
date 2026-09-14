import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { getEofyStatement } from "@/server/modules/reports/service";
import { currentFinancialYear, recentFinancialYears } from "@/server/au/fy";
import { abn as formatAbn } from "@/shared/format";
import { ENTITY_LABELS, GST_BASIS_LABELS } from "@/shared/labels";
import { formatBasisPoints } from "@/shared/money";
import { FyPicker } from "@/features/reports/components/fy-picker";
import { Alert, Badge, ButtonLink, Money } from "@/ui/primitives";
import { ReportActions } from "@/features/reports/components/report-actions";

export const metadata: Metadata = { title: "End of Financial Year Statement" };

function fyFrom(value: string | undefined): number {
  const current = currentFinancialYear();
  const fy = Number(value);
  return Number.isInteger(fy) && fy >= 2000 && fy <= current + 1 ? fy : current;
}

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-rule font-semibold" : ""}`}>
      <span className={strong ? "" : "text-ink-2"}>{label}</span>
      <Money cents={cents} emphasis={strong} />
    </div>
  );
}

export default async function EofyPage({
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
  const pack = await getEofyStatement(firmId, client.id, fy);
  if (!pack) notFound();

  const { profitAndLoss: pl, balanceSheet: bs } = pack;
  const q = `?fy=${fy}`;

  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <FyPicker basePath={`/clients/${id}/reports/eofy`} fy={fy} financialYears={recentFinancialYears(6)} />
        <span className="flex flex-wrap items-center gap-2">
          <ReportActions filename="eofy" />
          <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/reports`}>
            All reports
          </ButtonLink>
        </span>
      </div>

      <div className="sheet px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">End of Financial Year Statement</h2>
            <p className="mt-1 text-sm text-ink-2">
              {client.businessName}
              {client.legalName && client.legalName !== client.businessName ? ` (${client.legalName})` : ""} · ABN{" "}
              <span className="figure">{formatAbn(client.abn)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="neutral">{ENTITY_LABELS[client.entityType]}</Badge>
              <Badge tone={client.gstRegistered ? "accent" : "neutral"}>
                {client.gstRegistered ? `GST registered · ${GST_BASIS_LABELS[client.gstBasis]}` : "Not registered for GST"}
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <p className="figure text-2xl font-semibold">FY{fy}</p>
            <p className="text-xs text-ink-3">1 July {fy - 1} to 30 June {fy}</p>
          </div>
        </div>

        {bs.differenceCents !== 0 ? (
          <div className="pt-5">
            <Alert tone="negative" title="The ledger does not balance">
              Resolve the unbalanced journal before this statement is relied on.
            </Alert>
          </div>
        ) : null}

        <div className="grid gap-8 pt-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Profit &amp; Loss
              <Link href={`/clients/${id}/reports/profit-and-loss${q}`} className="text-xs font-medium text-accent hover:underline">
                Detail
              </Link>
            </h3>
            <div className="text-sm">
              <Line label="Income" cents={pl.totalIncomeCents} />
              <Line label="Direct costs" cents={pl.totalCogsCents} />
              <Line label="Gross profit" cents={pl.grossProfitCents} strong />
              <Line label="Expenses" cents={pl.totalExpensesCents} />
              <Line label="Net profit" cents={pl.netProfitCents} strong />
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Balance Sheet at 30 June {fy}
              <Link href={`/clients/${id}/reports/balance-sheet${q}`} className="text-xs font-medium text-accent hover:underline">
                Detail
              </Link>
            </h3>
            <div className="text-sm">
              <Line label="Total assets" cents={bs.totalAssetsCents} strong />
              <Line label="Liabilities" cents={bs.totalLiabilityAccountsCents} />
              <Line label="GST control" cents={bs.gstControlCents} />
              <Line label="Total liabilities" cents={bs.totalLiabilitiesCents} strong />
              <Line label="Equity on accounts" cents={bs.totalEquityAccountsCents} />
              <Line label="Retained earnings" cents={bs.retainedEarningsCents} />
              <Line label="Current year earnings" cents={bs.currentEarningsCents} />
              <Line label="Total equity" cents={bs.totalEquityCents} strong />
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Depreciation
              <Link href={`/clients/${id}/reports/depreciation${q}`} className="text-xs font-medium text-accent hover:underline">
                Schedule
              </Link>
            </h3>
            {pack.depreciation.lines.length === 0 ? (
              <p className="text-sm text-ink-3">No assets on the register for this year.</p>
            ) : (
              <div className="text-sm">
                {pack.depreciation.lines.map((line) => (
                  <Line key={line.assetId} label={line.name} cents={line.deductibleCents} />
                ))}
                <Line label="Deductible depreciation" cents={pack.depreciation.totalDeductibleCents} strong />
                <Line label="Written-down value at year end" cents={pack.depreciation.totalClosingCents} />
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Loans
              <Link href={`/clients/${id}/loans`} className="text-xs font-medium text-accent hover:underline">
                Register
              </Link>
            </h3>
            {pack.loans.length === 0 ? (
              <p className="text-sm text-ink-3">No active loans on the register.</p>
            ) : (
              <div className="text-sm">
                {pack.loans.map(({ loan, balanceCents, interestYearCents }) => (
                  <div key={loan.id} className="py-1.5">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-ink-2">{loan.lender}</span>
                      <Money cents={balanceCents} />
                    </div>
                    <p className="text-xs text-ink-3">
                      Balance at year end · interest for the year <Money cents={interestYearCents} className="text-xs" />
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {pack.partners ? (
            <section className="lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold">Partnership distribution of net profit</h3>
              {pack.partners.length === 0 ? (
                <p className="text-sm text-ink-3">No partners recorded — the shares are needed before profit can be distributed.</p>
              ) : (
                <div className="text-sm">
                  {pack.partners.map((partner) => (
                    <Line
                      key={partner.id}
                      label={`${partner.name} · ${formatBasisPoints(partner.shareBasisPoints)}`}
                      cents={Math.round((pl.netProfitCents * partner.shareBasisPoints) / 10_000)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Every figure on this page is the same sum shown on the detailed report it links to. Prepared
        for review by the registered tax advisor; nothing is lodged from here.
      </p>
    </div>
  );
}

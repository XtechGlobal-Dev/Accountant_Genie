import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { getClientHeader } from "@/server/modules/clients/service";
import { getSimpleBas, listBasStatements } from "@/server/modules/reports/service";
import { BasStatementsList, PrepareBasButton } from "@/features/reports/components/bas-statements";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import type { BasFigure, BasLabelKey } from "@/shared/contracts/report";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { Icon } from "@/ui/icons";
import { Alert, Badge, ButtonLink, Money } from "@/ui/primitives";
import { ReportActions } from "@/features/reports/components/report-actions";

export const metadata: Metadata = { title: "Business Activity Statement" };

const ORDER: BasLabelKey[] = ["G1", "G10", "G11", "1A", "1B", "W1", "W2"];
const VERIFY: ReadonlySet<BasLabelKey> = new Set(["W1", "W2"]);

/**
 * One BAS label, with the lines behind it one click away. That click is the
 * point: a figure an accountant cannot trace is a figure they cannot sign.
 */
function Figure({ clientId, figure, mappingVerified }: { clientId: string; figure: BasFigure; mappingVerified: boolean }) {
  const count = figure.contributors.length;
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span className="code inline-flex h-9 min-w-12 items-center justify-center rounded-lg bg-sunken px-2 text-sm font-semibold text-ink">
          {figure.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{figure.title}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            {count === 0 ? "No contributing lines" : `${count} line${count === 1 ? "" : "s"}`}
            {VERIFY.has(figure.label) ? (
              mappingVerified ? (
                <Badge tone="positive" title="The wages and PAYG withholding account mapping has been verified by the registered tax advisor.">
                  Verified mapping
                </Badge>
              ) : (
                <Badge tone="warning" title="Derived from the wages and PAYG withholding accounts. Mapping to be confirmed by the registered tax advisor under Settings → Tax rules.">
                  Verify mapping
                </Badge>
              )
            ) : null}
          </span>
        </span>
        <Money cents={figure.cents} emphasis className="text-[1.25rem]" />
        {count > 0 ? (
          <Icon
            name="chevron-down"
            className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180"
          />
        ) : null}
      </summary>
      {count > 0 ? (
        <div className="border-t border-rule">
          <table>
            <thead>
              <tr>
                <th className="w-28">Date</th>
                <th>Description</th>
                <th className="w-52">Account</th>
                <th className="w-36 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {figure.contributors.map((line, index) => (
                <tr key={`${line.entryId}-${index}`}>
                  <td className="figure text-ink-2">{shortDate(line.date)}</td>
                  <td>
                    <Link
                      href={`/clients/${clientId}/journals/${line.entryId}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {line.description ?? "Journal entry"}
                    </Link>
                    {line.reference ? <span className="code ml-2 text-ink-3">{line.reference}</span> : null}
                  </td>
                  <td className="text-ink-2">
                    <span className="code mr-1.5">{line.accountCode}</span>
                    {line.accountName}
                  </td>
                  <td className="text-right">
                    <Money cents={line.cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

export default async function BasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fy?: string; q?: string; m?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const { firmId } = session;
  // Preparing a BAS for a fee is regulated conduct; reading one needs the
  // permission that says this person is part of that work.
  if (!can(session, "bas:prepare")) notFound();

  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const period = resolvePeriod(query);
  const [report, statements] = await Promise.all([getSimpleBas(firmId, client.id, period), listBasStatements(firmId, client.id)]);
  if (!report || !statements) notFound();

  const { bas } = report;
  const basePath = `/clients/${id}/reports/bas`;
  const lastDay = new Date(period.end.getTime() - 86_400_000);
  const ready = bas.unresolvedCount === 0;

  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker basePath={basePath} period={period} financialYears={recentFinancialYears(6)} />
        <span className="flex flex-wrap items-center gap-2">
          <PrepareBasButton clientId={id} query={query} canPrepare={can(session, "bas:prepare")} ready={bas.unresolvedCount === 0} />
          <ReportActions filename="bas" />
          <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/reports`}>
            All reports
          </ButtonLink>
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-[1.625rem]">Business Activity Statement</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {client.businessName} · {period.label} ·{" "}
            <span className="figure">
              {shortDate(period.start)} — {shortDate(lastDay)}
            </span>
          </p>
        </div>
        {ready ? (
          <Badge tone="positive">Every line resolved</Badge>
        ) : (
          <Badge tone="negative">Not ready</Badge>
        )}
      </div>

      {!client.gstRegistered ? (
        <Alert tone="info" title="This client is not registered for GST">
          No GST was charged or claimed on their journals, so 1A and 1B are nil. The purchase and
          sales labels are shown for reference only.
        </Alert>
      ) : null}

      {!ready ? (
        <Alert tone="negative" title={`${bas.unresolvedCount} journal line${bas.unresolvedCount === 1 ? "" : "s"} with no tax treatment`}>
          A BAS is not prepared while any line in the period is unallocated. Code those lines to a
          real account first; the figures below exclude them.
        </Alert>
      ) : null}

      {bas.inputTaxedOmittedCount > 0 ? (
        <Alert tone="warning" title={`${bas.inputTaxedOmittedCount} input-taxed line${bas.inputTaxedOmittedCount === 1 ? "" : "s"} left out of G1 and G11`}>
          Whether input-taxed sales count at G1 and input-taxed purchases at G11 is a rule the
          registered tax advisor verifies under Settings → Tax rules. Until then those lines contribute
          to no label — G1 and G11 are understated by that much. 1A and 1B are unaffected.
        </Alert>
      ) : null}

      <div className="card flex flex-wrap items-center justify-between gap-4 bg-accent-soft/60 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Net GST for the period</p>
          <p className="text-xs text-ink-2">1A less 1B. Positive is owed to the ATO; negative is a refund.</p>
        </div>
        <Money cents={bas.netGstCents} emphasis className="text-[1.5rem]" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ORDER.map((label) => (
          <Figure key={label} clientId={id} figure={bas.figures[label]} mappingVerified={report.mappingVerified} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Built from {bas.lineCount.toLocaleString("en-AU")} journal lines. Labels are sums of the tax
        treatment each line was posted under; GST figures are what the posting engine computed at the
        time, never re-estimated. Shown in dollars and cents; the ATO form takes whole dollars. This
        statement is prepared for review and is not lodged from here.
      </p>

      <BasStatementsList clientId={id} statements={statements} />
    </div>
  );
}

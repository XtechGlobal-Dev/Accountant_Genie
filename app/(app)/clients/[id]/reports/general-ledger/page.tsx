import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { asAtOf, getGeneralLedger } from "@/server/modules/reports/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import { recentFinancialYears } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "General Ledger" };

export default async function GeneralLedgerPage({
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
  const report = await getGeneralLedger(firmId, client.id, period);
  if (!report) notFound();

  return (
    <ReportFrame
      clientId={id}
      picker={<PeriodPicker basePath={`/clients/${id}/reports/general-ledger`} period={period} financialYears={recentFinancialYears(6)} />}
      title="General Ledger"
      subtitle={
        <>
          {client.businessName} · {period.label} ·{" "}
          <span className="figure">
            {shortDate(period.start)} — {shortDate(asAtOf(period))}
          </span>{" "}
          · balances debit-positive
        </>
      }
      footnote={`${report.lineCount.toLocaleString("en-AU")} journal lines in the period. Opening balances are brought forward from every line before it; each entry links to the journal it came from.`}
    >
      {report.accounts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-2">No movements in this period.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="w-28">Date</th>
              <th className="w-28">Reference</th>
              <th>Description</th>
              <th className="w-36 text-right">Debit</th>
              <th className="w-36 text-right">Credit</th>
              <th className="w-40 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {report.accounts.map((account) => (
              <>
                <tr key={`${account.accountId}-h`}>
                  <th className="group-row" colSpan={6}>
                    <span className="code mr-2">{account.code}</span>
                    {account.name}
                  </th>
                </tr>
                <tr key={`${account.accountId}-o`}>
                  <td colSpan={5} className="text-ink-3">
                    Opening balance
                  </td>
                  <td className="text-right text-ink-2">
                    <Money cents={account.openingCents} />
                  </td>
                </tr>
                {account.entries.map((entry, index) => (
                  <tr key={`${account.accountId}-${entry.entryId}-${index}`}>
                    <td className="figure text-ink-2">{shortDate(entry.date)}</td>
                    <td className="code text-ink-2">{entry.reference ?? "—"}</td>
                    <td>
                      <Link href={`/clients/${id}/journals/${entry.entryId}`} className="hover:text-accent">
                        {entry.description ?? "Journal entry"}
                      </Link>
                    </td>
                    <td className="text-right">{entry.debitCents > 0 ? <Money cents={entry.debitCents} /> : <span className="text-ink-3">—</span>}</td>
                    <td className="text-right">{entry.creditCents > 0 ? <Money cents={entry.creditCents} /> : <span className="text-ink-3">—</span>}</td>
                    <td className="text-right">
                      <Money cents={entry.balanceCents} />
                    </td>
                  </tr>
                ))}
                <tr key={`${account.accountId}-c`}>
                  <td colSpan={3} className="font-semibold">
                    Closing balance
                  </td>
                  <td className="text-right text-ink-2">
                    <Money cents={account.totalDebitCents} />
                  </td>
                  <td className="text-right text-ink-2">
                    <Money cents={account.totalCreditCents} />
                  </td>
                  <td className="text-right">
                    <Money cents={account.closingCents} emphasis />
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}

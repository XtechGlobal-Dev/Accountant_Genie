import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getLoan } from "@/server/modules/loans/service";
import { shortDate } from "@/shared/format";
import { formatBasisPoints } from "@/shared/money";
import { Alert, Badge, ButtonLink, Card, CardHeader, Money, StatCard } from "@/ui/primitives";

export const metadata: Metadata = { title: "Loan schedule" };

/** One loan's amortisation, period by period. */
export default async function LoanSchedulePage({
  params,
}: {
  params: Promise<{ id: string; loanId: string }>;
}) {
  const { id, loanId } = await params;
  const { firmId } = await requireSession();
  const result = await getLoan(firmId, id, loanId);
  if (!result) notFound();

  const { loan, schedule } = result;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{loan.lender}</h2>
            <Badge tone={loan.status === "ACTIVE" ? "positive" : "neutral"}>{loan.status === "ACTIVE" ? "Active" : "Closed"}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            <Money cents={loan.principalCents} /> at <span className="figure">{formatBasisPoints(loan.interestRateBasisPoints)}</span> p.a. over{" "}
            <span className="figure">{loan.termMonths}</span> months from <span className="figure">{shortDate(loan.startDate)}</span>
            {loan.accountName ? ` · ${loan.accountName}` : ""}
          </p>
        </div>
        <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/loans`}>
          All loans
        </ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Balance today" value={<Money cents={schedule.balanceAtCents} emphasis className="text-[2rem]" />} icon="banknote" />
        <StatCard label="Total interest" value={<Money cents={schedule.totalInterestCents} emphasis className="text-[2rem]" />} icon="percent" hint="Over the whole term" />
        <StatCard label="Repayments" value={schedule.rows.length} icon="calendar" hint="Scheduled periods" />
        <StatCard label="Balloon" value={<Money cents={schedule.balloonCents} emphasis className="text-[2rem]" />} icon="alert-triangle" tone={schedule.balloonCents > 0 ? "warning" : "default"} hint={schedule.balloonCents > 0 ? "Left owing at the end of the term" : "Cleared within the term"} />
      </div>

      {schedule.balloonCents > 0 ? (
        <Alert tone="warning" title="The repayment does not clear this loan">
          At the end of the term <Money cents={schedule.balloonCents} /> is still owing. Check the repayment amount against the contract, or record the balloon.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Schedule" description="Interest is the opening balance × the periodic rate, rounded to the cent; the rest of the repayment reduces principal." />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="w-16">#</th>
                <th className="w-28">Date</th>
                <th className="text-right">Opening</th>
                <th className="w-32 text-right">Interest</th>
                <th className="w-32 text-right">Principal</th>
                <th className="w-32 text-right">Repayment</th>
                <th className="w-36 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((row) => (
                <tr key={row.period}>
                  <td className="figure text-ink-3">{row.period}</td>
                  <td className="figure text-ink-2">{shortDate(row.date)}</td>
                  <td className="text-right"><Money cents={row.openingCents} /></td>
                  <td className="text-right"><Money cents={row.interestCents} /></td>
                  <td className="text-right"><Money cents={row.principalCents} /></td>
                  <td className="text-right"><Money cents={row.repaymentCents} /></td>
                  <td className="text-right"><Money cents={row.closingCents} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td className="text-right"><Money cents={schedule.totalInterestCents} emphasis /></td>
                <td className="text-right"><Money cents={schedule.totalPrincipalCents} emphasis /></td>
                <td className="text-right"><Money cents={schedule.totalInterestCents + schedule.totalPrincipalCents} emphasis /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

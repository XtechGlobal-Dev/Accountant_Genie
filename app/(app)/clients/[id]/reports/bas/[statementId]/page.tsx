import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { getClientHeader } from "@/server/modules/clients/service";
import { getBasStatement } from "@/server/modules/reports/service";
import { shortDate } from "@/shared/format";
import { BasStatementDetail } from "@/features/reports/components/bas-statements";
import { Badge, ButtonLink } from "@/ui/primitives";

export const metadata: Metadata = { title: "Prepared BAS" };

/** One prepared statement, as it was prepared. Re-scoped from the session like every page. */
export default async function BasStatementPage({ params }: { params: Promise<{ id: string; statementId: string }> }) {
  const { id, statementId } = await params;
  const session = await requireSession();
  const client = await getClientHeader(session.firmId, id);
  if (!client) notFound();
  const statement = await getBasStatement(session.firmId, client.id, statementId);
  if (!statement) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex flex-wrap items-center justify-end gap-3">
        <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/reports/bas`}>
          Live BAS
        </ButtonLink>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-[1.625rem]">Business Activity Statement · prepared</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {client.businessName} · {statement.periodLabel} ·{" "}
            <span className="figure">
              {shortDate(statement.periodStart)} — {shortDate(new Date(statement.periodEnd.getTime() - 86_400_000))}
            </span>
          </p>
        </div>
        {statement.status === "FINAL" ? <Badge tone="positive">Final</Badge> : <Badge tone="warning">Draft</Badge>}
      </div>
      <BasStatementDetail
        clientId={id}
        statement={statement}
        canAdjust={can(session, "bas:prepare")}
        canFinalise={can(session, "bas:approve")}
      />
    </div>
  );
}

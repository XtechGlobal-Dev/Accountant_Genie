import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { hasClientLedgerData } from "@/server/modules/clients/service";
import { ReportsEmptyState } from "@/features/reports/components/reports-empty-state";

/**
 * Reports need a ledger. Until this client has a transaction or a journal
 * there is nothing any report could show, so every report route — the
 * index included — shows the ways in instead of an empty sheet.
 *
 * The check is re-scoped here from the session; a layout is not an
 * authorisation boundary, and each report page still scopes its own data.
 */
export default async function ReportsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { firmId } = await requireSession();

  const hasData = await hasClientLedgerData(firmId, id);
  if (hasData === null) notFound();

  return hasData ? children : <ReportsEmptyState clientId={id} />;
}

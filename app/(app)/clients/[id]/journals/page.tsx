import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listAccountOptions } from "@/server/modules/accounts/service";
import { listJournals } from "@/server/modules/ledger/service";
import { recentFinancialYears } from "@/server/au/fy";
import { listSubcontractorOptions } from "@/server/modules/subcontractors/service";
import { JournalsView } from "@/features/ledger/components/journals-view";

export const metadata: Metadata = { title: "Journals" };

/**
 * The client's ledger, entry by entry. Read through the ledger service,
 * mutated only through its server actions.
 */
export default async function ClientJournalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; opening?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { firmId } = await requireSession();

  const [entries, accounts, subcontractors] = await Promise.all([
    listJournals(firmId, id),
    listAccountOptions(firmId, id),
    listSubcontractorOptions(firmId, id),
  ]);
  // `null` is a client this firm does not own — indistinguishable from none.
  if (!entries || !accounts || !subcontractors) notFound();

  return (
    <JournalsView
      clientId={id}
      entries={entries}
      accounts={accounts}
      financialYears={recentFinancialYears(6)}
      subcontractors={subcontractors}
      initialOpen={query.new === "1" ? "MANUAL" : query.opening === "1" ? "OPENING" : null}
    />
  );
}

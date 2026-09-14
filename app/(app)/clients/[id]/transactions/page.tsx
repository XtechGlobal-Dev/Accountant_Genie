import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listAccountOptions } from "@/server/modules/accounts/service";
import { listAccounts as listBankAccounts } from "@/server/modules/banking/service";
import { getClientHeader } from "@/server/modules/clients/service";
import { getReviewSummary, listTransactions } from "@/server/modules/reconcile/service";
import { listSubcontractorOptions } from "@/server/modules/subcontractors/service";
import { ReviewView } from "@/features/review/components/review-view";

export const metadata: Metadata = { title: "Transactions" };

/** The review screen. Everything here is read through services; every action re-authenticates. */
export default async function ClientTransactionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { firmId } = await requireSession();

  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const [rows, summary, accounts, bankAccounts, subcontractors] = await Promise.all([
    listTransactions(firmId, client.id),
    getReviewSummary(firmId, client.id),
    listAccountOptions(firmId, client.id),
    listBankAccounts(firmId, client.id),
    listSubcontractorOptions(firmId, client.id),
  ]);
  if (!rows || !summary || !accounts || !bankAccounts || !subcontractors) notFound();

  return (
    <ReviewView
      clientId={client.id}
      clientName={client.businessName}
      rows={rows}
      summary={summary}
      accounts={accounts}
      subcontractors={subcontractors}
      bankAccounts={bankAccounts.map((b) => ({ id: b.id, name: b.name }))}
    />
  );
}

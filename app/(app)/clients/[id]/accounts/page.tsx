import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { canVerifyTax } from "@/server/core/permissions";
import { getChartOfAccounts } from "@/server/modules/accounts/service";
import { getClientHeader, listClientOptions } from "@/server/modules/clients/service";
import { ChartOfAccountsView } from "@/features/accounts/components/chart-of-accounts-view";

export const metadata: Metadata = { title: "Chart of accounts" };

/**
 * The chart as this client posts against it: system accounts, the firm's
 * firm-wide accounts, and the client's own. Accounts added here belong to
 * the client alone.
 */
export default async function ClientAccountsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const { firmId } = session;

  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const [chart, clients] = await Promise.all([
    getChartOfAccounts(firmId, client.id),
    listClientOptions(firmId),
  ]);

  return (
    <ChartOfAccountsView
      chart={chart}
      clients={clients}
      scope={{ id: client.id, name: client.businessName }}
      isTaxAgent={canVerifyTax(session)}
    />
  );
}

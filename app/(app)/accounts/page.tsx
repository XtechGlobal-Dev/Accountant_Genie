import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { getChartOfAccounts } from "@/server/modules/accounts/service";
import { listClientOptions } from "@/server/modules/clients/service";
import { ChartOfAccountsView } from "@/features/accounts/components/chart-of-accounts-view";

export const metadata: Metadata = { title: "Chart of Accounts" };

/** The firm's whole chart: the Australian default plus everything the firm has added. */
export default async function AccountsPage() {
  const session = await requireSession();
  const [chart, clients] = await Promise.all([
    getChartOfAccounts(session.firmId),
    listClientOptions(session.firmId),
  ]);

  return <ChartOfAccountsView chart={chart} clients={clients} isTaxAgent={session.isTaxAgent} />;
}

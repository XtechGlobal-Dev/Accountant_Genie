import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import {
  listFeedConnections,
  listFeedRequests,
  listInstitutions,
  listLiveBalances,
  listSyncRuns,
} from "@/server/modules/banking/feeds";
import {
  feedDeliveryIsAutomatic,
  feedProviderConfigured,
  feedProviderName,
} from "@/server/modules/banking/feed-provider";
import { listAccounts } from "@/server/modules/banking/service";
import { getClientHeader } from "@/server/modules/clients/service";
import { BankAccountsView } from "@/features/banking/components/bank-accounts-view";

export const metadata: Metadata = { title: "Bank accounts" };

/**
 * The client's bank accounts — the source of every transaction that reaches
 * the ledger — plus statement uploads and live bank feeds.
 *
 * Read through the banking service, mutated through its server actions. The
 * balances are the one thing on this page read live from the provider rather
 * than from our database, which is why the page is dynamic.
 */
export default async function ClientBanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upload?: string; feed?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { firmId } = await requireSession();

  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const [accounts, feedRequests, feedConnections, feedSyncRuns, live, feedInstitutions] =
    await Promise.all([
      listAccounts(firmId, client.id),
      listFeedRequests(firmId, client.id),
      listFeedConnections(firmId, client.id),
      listSyncRuns(firmId, client.id),
      listLiveBalances(firmId, client.id),
      listInstitutions(),
    ]);

  if (!accounts || !feedRequests || !feedConnections || !feedSyncRuns || !live) notFound();

  return (
    <BankAccountsView
      clientId={client.id}
      clientName={client.businessName}
      accounts={accounts}
      feedRequests={feedRequests}
      feedConnections={feedConnections}
      feedInstitutions={feedInstitutions}
      feedSyncRuns={feedSyncRuns}
      liveBalances={live.balances}
      liveBalanceError={live.error}
      providerConfigured={feedProviderConfigured()}
      providerName={feedProviderName()}
      deliveryIsAutomatic={feedDeliveryIsAutomatic()}
      justConnected={query.feed === "connected"}
      openUpload={query.upload === "1"}
      openFeed={query.feed === "1"}
    />
  );
}

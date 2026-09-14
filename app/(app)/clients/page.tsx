import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { listClients } from "@/server/modules/clients/service";
import { ClientsView } from "@/features/clients/components/clients-view";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  // Next 15+ : searchParams is async
  searchParams: Promise<{ archived?: string; new?: string }>;
}) {
  const { firmId } = await requireSession();
  const params = await searchParams;
  const showingArchived = params.archived === "true";

  const clients = await listClients(firmId, showingArchived);

  return (
    <ClientsView
      clients={clients}
      showingArchived={showingArchived}
      openNew={params.new === "1"}
    />
  );
}

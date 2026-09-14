import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listAccountOptions } from "@/server/modules/accounts/service";
import { getClientHeader } from "@/server/modules/clients/service";
import { listMemory } from "@/server/modules/reconcile/service";
import { MemoryView } from "@/features/review/components/memory-view";

export const metadata: Metadata = { title: "Coding Memory" };

export default async function ClientMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();

  const client = await getClientHeader(firmId, id);
  if (!client) notFound();

  const [rules, accounts] = await Promise.all([
    listMemory(firmId, client.id),
    listAccountOptions(firmId, client.id),
  ]);
  if (!rules || !accounts) notFound();

  return (
    <MemoryView rules={rules} accounts={accounts} scope={{ clientId: client.id, clientName: client.businessName }} />
  );
}

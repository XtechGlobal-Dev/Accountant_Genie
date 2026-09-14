import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { listFirmAccountOptions } from "@/server/modules/accounts/service";
import { listMemory } from "@/server/modules/reconcile/service";
import { MemoryView } from "@/features/review/components/memory-view";

export const metadata: Metadata = { title: "Coding Memory" };

/** Every rule the firm has taught the engine, across all clients. */
export default async function FirmMemoryPage() {
  const { firmId } = await requireSession();
  const [rules, accounts] = await Promise.all([listMemory(firmId), listFirmAccountOptions(firmId)]);
  return <MemoryView rules={rules ?? []} accounts={accounts} scope={null} />;
}

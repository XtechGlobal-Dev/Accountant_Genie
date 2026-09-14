import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listAccountOptions } from "@/server/modules/accounts/service";
import { listAssets } from "@/server/modules/assets/service";
import { AssetsView } from "@/features/registers/components/assets-view";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();
  const [rows, accounts] = await Promise.all([listAssets(firmId, id), listAccountOptions(firmId, id)]);
  if (!rows || !accounts) notFound();
  return <AssetsView clientId={id} rows={rows} accounts={accounts} />;
}

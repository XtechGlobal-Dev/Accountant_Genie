import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listSubcontractors } from "@/server/modules/subcontractors/service";
import { SubcontractorsView } from "@/features/registers/components/subcontractors-view";

export const metadata: Metadata = { title: "Subcontractors" };

export default async function SubcontractorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();
  const rows = await listSubcontractors(firmId, id);
  if (!rows) notFound();
  return <SubcontractorsView clientId={id} rows={rows} />;
}

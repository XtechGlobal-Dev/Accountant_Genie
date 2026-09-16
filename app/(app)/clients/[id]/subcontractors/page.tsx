import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { listSubcontractors } from "@/server/modules/subcontractors/service";
import { SubcontractorProposalsPanel } from "@/features/registers/components/subcontractor-proposals";
import { SubcontractorsView } from "@/features/registers/components/subcontractors-view";

export const metadata: Metadata = { title: "Subcontractors" };

export default async function SubcontractorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const rows = await listSubcontractors(session.firmId, id);
  if (!rows) notFound();
  return (
    <div className="flex flex-col gap-5">
      <SubcontractorsView clientId={id} rows={rows} />
      <SubcontractorProposalsPanel clientId={id} canManage={can(session, "register:manage") && can(session, "transaction:update")} />
    </div>
  );
}

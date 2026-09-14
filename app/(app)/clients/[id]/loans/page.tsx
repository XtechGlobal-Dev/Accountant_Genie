import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { listAccountOptions } from "@/server/modules/accounts/service";
import { listLoans } from "@/server/modules/loans/service";
import { LoansView } from "@/features/registers/components/loans-view";

export const metadata: Metadata = { title: "Loans" };

export default async function LoansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();
  const [rows, accounts] = await Promise.all([listLoans(firmId, id), listAccountOptions(firmId, id)]);
  if (!rows || !accounts) notFound();
  return <LoansView clientId={id} rows={rows} accounts={accounts} />;
}

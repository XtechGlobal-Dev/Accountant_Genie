import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { listTaxRules } from "@/server/modules/tax-rules/service";
import { TaxRulesView } from "@/features/settings/components/tax-rules-view";

export const metadata: Metadata = { title: "Tax rules" };

export default async function TaxRulesPage() {
  const session = await requireSession();
  const rules = await listTaxRules();
  return <TaxRulesView rules={rules} isTaxAgent={session.isTaxAgent} canPropose={can(session, "organisation:manage")} />;
}

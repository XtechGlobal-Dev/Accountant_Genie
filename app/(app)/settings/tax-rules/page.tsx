import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { can, canVerifyTax } from "@/server/core/permissions";
import { listTaxRules } from "@/server/modules/tax-rules/service";
import { TaxRulesView } from "@/features/settings/components/tax-rules-view";

export const metadata: Metadata = { title: "Tax rules" };

/**
 * The firm's own tax rule versions. Verification needs both the permission
 * and the registration — see `canVerifyTax` — and never reaches another firm.
 */
export default async function TaxRulesPage() {
  const session = await requireSession();
  const rules = await listTaxRules(session.firmId);
  return (
    <TaxRulesView
      rules={rules}
      canVerify={canVerifyTax(session)}
      canPropose={can(session, "organisation:manage") || can(session, "tax:verify")}
    />
  );
}

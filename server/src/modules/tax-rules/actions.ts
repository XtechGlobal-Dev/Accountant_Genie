"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { CalendarDateSchema } from "@/server/modules/ledger/schema";
import { parseCents } from "@/shared/money";
import type { ActionResult } from "@/shared/contracts/result";
import * as service from "./service";

const ProposeSchema = z.object({
  code: z.string().trim().min(1).max(64),
  value: z.string().trim().max(300),
  effectiveFrom: CalendarDateSchema,
  note: z.string().trim().max(500).optional(),
  kind: z.enum(["AMOUNT", "TEXT"]),
});

export async function proposeTaxRule(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "organisation:manage") && !session.isTaxAgent) return forbidden();

  const parsed = ProposeSchema.safeParse({
    code: formData.get("code"),
    value: formData.get("value") ?? "",
    effectiveFrom: formData.get("effectiveFrom") ?? "",
    note: formData.get("note") ?? "",
    kind: formData.get("kind"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form", field: String(parsed.error.issues[0]?.path[0] ?? "") };

  const { code, value, effectiveFrom, note, kind } = parsed.data;
  const valueCents = kind === "AMOUNT" ? parseCents(value) : null;
  if (kind === "AMOUNT" && (valueCents === null || valueCents < 0)) {
    return { ok: false, error: "Enter the amount in dollars and cents", field: "value" };
  }

  const result = await service.proposeVersion(session.firmId, session.userId, {
    code,
    valueCents,
    valueText: kind === "TEXT" ? value : null,
    effectiveFrom,
    note: note || null,
  });
  if (result.ok) revalidatePath("/settings/tax-rules");
  return result;
}

/** Only a registered tax agent signs a rule off. That is the whole point of the workflow. */
export async function verifyTaxRule(versionId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isTaxAgent) return { ok: false, error: "Only a registered tax agent can verify a tax rule" };

  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const result = await service.verifyVersion(session.firmId, session.userId, versionId, note);
  if (result.ok) {
    revalidatePath("/settings/tax-rules");
    revalidatePath("/clients", "layout");
  }
  return result;
}

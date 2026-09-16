"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import type { SubcontractorProposals } from "@/shared/contracts/register";
import * as reconcile from "@/server/modules/reconcile/service";
import { subcontractorFromForm } from "./schema";
import * as service from "./service";

export async function createSubcontractor(clientId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = subcontractorFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.createSubcontractor(firmId, userId, clientId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function updateSubcontractor(
  clientId: string,
  subcontractorId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = subcontractorFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.updateSubcontractor(firmId, userId, subcontractorId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

/**
 * Ask the model which unlinked payments went to which subcontractor. Read
 * only: it returns proposals for a person to confirm through a recode.
 */
export async function proposeSubcontractors(clientId: string): Promise<SubcontractorProposals | null> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return null;
  return service.proposeSubcontractorLinks(session.firmId, clientId);
}

/**
 * Confirm one proposal: link the payment to a register entry, adding the
 * entry first when the model proposed a new name. Both steps re-check
 * ownership — the transaction, the subcontractor and the account are all
 * this client's or the link is refused.
 */
export async function confirmSubcontractorLink(
  clientId: string,
  transactionId: string,
  choice: { knownId: string } | { newName: string },
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage") || !can(session, "transaction:update")) return forbidden();
  const { firmId, userId } = session;

  let subcontractorId: string;
  if ("knownId" in choice) {
    subcontractorId = choice.knownId;
  } else {
    const form = new FormData();
    form.set("name", choice.newName);
    const parsed = subcontractorFromForm(form);
    if (!parsed.success) return invalid(parsed.error);
    const created = await service.createSubcontractor(firmId, userId, clientId, parsed.data);
    if (!created.ok || !created.id) return created;
    subcontractorId = created.id;
  }

  const row = await reconcile.listTransactions(firmId, clientId);
  const transaction = row?.find((t) => t.id === transactionId);
  if (!transaction || !transaction.accountId) return { ok: false, error: "Transaction not found" };

  const result = await reconcile.recodeTransaction(firmId, userId, transactionId, {
    accountId: transaction.accountId,
    remember: "NONE",
    matchType: "EXACT",
    subcontractorId,
    version: transaction.version,
  });
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function setSubcontractorActive(
  clientId: string,
  subcontractorId: string,
  active: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const result = await service.setSubcontractorActive(firmId, userId, subcontractorId, active);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

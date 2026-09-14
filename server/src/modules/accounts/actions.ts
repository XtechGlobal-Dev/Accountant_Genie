"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { customAccountFromForm } from "./schema";
import * as service from "./service";

/** The transport edge of the accounts module. Session, validate, call, revalidate. */

function revalidateChart(clientId?: string | null) {
  revalidatePath("/accounts");
  if (clientId) revalidatePath(`/clients/${clientId}/accounts`);
}

export async function createAccount(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "account:manage")) return forbidden();
  const { firmId, userId } = session;

  const parsed = customAccountFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.createCustomAccount(firmId, userId, parsed.data);
  if (result.ok) revalidateChart(parsed.data.clientId);
  return result;
}

export async function updateAccount(
  accountId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "account:manage")) return forbidden();
  const { firmId, userId } = session;

  const parsed = customAccountFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.updateCustomAccount(firmId, userId, accountId, parsed.data);
  if (result.ok) revalidateChart(parsed.data.clientId);
  return result;
}

/** Only a registered tax agent verifies a tax treatment. */
export async function verifyAccountTreatment(accountId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isTaxAgent) return { ok: false, error: "Only a registered tax agent can verify a tax treatment" };

  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  const result = await service.verifyAccountTreatment(session.firmId, session.userId, accountId, note);
  if (result.ok) revalidateChart();
  return result;
}

export async function setAccountActive(
  accountId: string,
  active: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "account:manage")) return forbidden();
  const { firmId, userId } = session;

  const result = await service.setCustomAccountActive(firmId, userId, accountId, active);
  if (result.ok) revalidateChart();
  return result;
}

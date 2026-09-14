"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
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

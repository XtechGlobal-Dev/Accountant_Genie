"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { updateFirmFromForm, updateProfileFromForm } from "./schema";
import * as service from "./service";

/** The transport edge of the firms module. Session, validate, call, revalidate. */

export async function updateFirm(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "organisation:manage")) return forbidden();
  const { firmId, userId } = session;

  const parsed = updateFirmFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.updateFirm(firmId, userId, parsed.data);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const { firmId, userId } = await requireSession();

  const parsed = updateProfileFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.updateProfile(firmId, userId, parsed.data);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

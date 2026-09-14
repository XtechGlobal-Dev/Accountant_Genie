"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { assetFromForm, disposeAssetFromForm } from "./schema";
import * as service from "./service";

export async function createAsset(clientId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = assetFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.createAsset(firmId, userId, clientId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function updateAsset(clientId: string, assetId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = assetFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.updateAsset(firmId, userId, assetId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function disposeAsset(clientId: string, assetId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = disposeAssetFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.disposeAsset(firmId, userId, assetId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

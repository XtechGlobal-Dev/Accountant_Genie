"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { loanFromForm } from "./schema";
import * as service from "./service";

export async function createLoan(clientId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = loanFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.createLoan(firmId, userId, clientId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function updateLoan(clientId: string, loanId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = loanFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.updateLoan(firmId, userId, loanId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

export async function setLoanStatus(
  clientId: string,
  loanId: string,
  status: "ACTIVE" | "CLOSED",
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "register:manage")) return forbidden();
  const { firmId, userId } = session;
  const result = await service.setLoanStatus(firmId, userId, loanId, status);
  if (result.ok) revalidatePath(`/clients/${clientId}`, "layout");
  return result;
}

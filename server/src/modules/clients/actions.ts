"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid, notFound, ok } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import {
  PartnersSchema,
  clientNoteFromForm,
  createClientFromForm,
  updateClientFromForm,
} from "./schema";
import * as service from "./service";

/**
 * The transport edge of the clients module.
 *
 * Every action does the same four things and nothing else: resolve the session,
 * validate the input, call a service, and tell Next what to revalidate. No
 * Prisma, no business rules — those are one and two layers down, where they can
 * be tested without a request.
 *
 * Server actions are public API surface. Each one re-authenticates: being
 * reachable only from a page that already checked is not a guarantee, because
 * the endpoint is callable directly.
 *
 * See .claude/skills/tenant-security/SKILL.md.
 */

export async function createClient(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:create")) return forbidden();
  const { firmId } = session;

  const parsed = createClientFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const client = await service.createClient(firmId, parsed.data);

  revalidatePath("/clients");
  return ok(client.id);
}

export async function updateClient(
  clientId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId } = session;

  const parsed = updateClientFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const updated = await service.updateClient(firmId, clientId, parsed.data);
  if (!updated) return notFound("Client");

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return ok(clientId);
}

export async function setClientArchived(
  clientId: string,
  archived: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:archive")) return forbidden();
  const { firmId } = session;

  const updated = await service.setClientArchived(firmId, clientId, archived);
  if (!updated) return notFound("Client");

  revalidatePath("/clients");
  return ok();
}

export async function addClientNote(
  clientId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId } = session;

  const parsed = clientNoteFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  const added = await service.addClientNote(firmId, clientId, parsed.data);
  if (!added) return notFound("Client");

  revalidatePath(`/clients/${clientId}`);
  return ok(clientId);
}

/** `payload` is whatever the caller sent; the schema decides what it is. */
export async function savePartners(clientId: string, payload: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "client:update")) return forbidden();
  const { firmId, userId } = session;

  const parsed = PartnersSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.savePartners(firmId, userId, clientId, parsed.data);
  if (result.ok) revalidatePath(`/clients/${clientId}/details`);
  return result;
}

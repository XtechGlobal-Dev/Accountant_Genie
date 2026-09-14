"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { JournalInputSchema, ReverseJournalSchema } from "./schema";
import * as service from "./service";

/**
 * The transport edge of the ledger. Session, validate, call, revalidate.
 *
 * `payload` is `unknown` on purpose: a server action is a public endpoint and
 * its argument is whatever the caller sent. The schema decides what it is.
 */

function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/journals`);
  revalidatePath(`/clients/${clientId}/reports`, "layout");
}

export async function postJournal(clientId: string, payload: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "journal:post")) return forbidden();
  const { firmId, userId } = session;

  const parsed = JournalInputSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.postJournal(firmId, userId, clientId, parsed.data);
  if (result.ok) revalidateClient(clientId);
  return result;
}

export async function reverseJournal(
  clientId: string,
  entryId: string,
  payload: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "journal:reverse")) return forbidden();
  const { firmId, userId } = session;

  const parsed = ReverseJournalSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.reverseJournal(firmId, userId, clientId, entryId, parsed.data);
  if (result.ok) {
    revalidateClient(clientId);
    revalidatePath(`/clients/${clientId}/journals/${entryId}`);
  }
  return result;
}

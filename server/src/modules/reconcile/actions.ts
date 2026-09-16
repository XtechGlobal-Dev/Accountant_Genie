"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import type { ActionResult } from "@/shared/contracts/result";
import { ExcludeSchema, IdListSchema, MemoryRuleUpdateSchema, RecodeSchema } from "./schema";
import * as service from "./service";

/** The transport edge of the review workflow. Session, validate, call, revalidate. */

function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`, "layout");
  revalidatePath("/memory");
}

/**
 * Queue a reconciliation run. The engine never runs inside a request — it
 * makes AI calls and holds a long transaction — so this returns a job id and
 * the Activity Panel shows the run.
 */
export async function runReconciliation(
  clientId: string,
): Promise<{ ok: true; jobId: string; existed: boolean } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!can(session, "transaction:update")) return forbidden();
  const { firmId, userId } = session;
  const job = await service.queueReconciliation(firmId, userId, clientId);
  if (!job) return { ok: false, error: "Client not found" };
  revalidateClient(clientId);
  return { ok: true, ...job };
}

export async function recodeTransaction(
  clientId: string,
  transactionId: string,
  payload: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:update")) return forbidden();
  const { firmId, userId } = session;
  const parsed = RecodeSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.recodeTransaction(firmId, userId, transactionId, parsed.data);
  if (result.ok) revalidateClient(clientId);
  return result;
}

export async function acceptTransactions(
  clientId: string,
  payload: unknown,
): Promise<{ ok: true; accepted: number; skipped: { id: string; reason: string }[] } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!can(session, "transaction:approve")) return forbidden();
  const { firmId, userId } = session;
  const parsed = IdListSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid selection" };

  const outcome = await service.acceptTransactions(firmId, userId, parsed.data);
  revalidateClient(clientId);
  return { ok: true, ...outcome };
}

export async function reopenTransaction(clientId: string, transactionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:approve")) return forbidden();
  const { firmId, userId } = session;
  const result = await service.reopenTransaction(firmId, userId, transactionId);
  if (result.ok) revalidateClient(clientId);
  return result;
}

export async function excludeTransaction(
  clientId: string,
  transactionId: string,
  payload: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:exclude")) return forbidden();
  const { firmId, userId } = session;
  const parsed = ExcludeSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.excludeTransaction(firmId, userId, transactionId, parsed.data);
  if (result.ok) revalidateClient(clientId);
  return result;
}

export async function restoreTransaction(clientId: string, transactionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:exclude")) return forbidden();
  const { firmId, userId } = session;
  const result = await service.restoreTransaction(firmId, userId, transactionId);
  if (result.ok) revalidateClient(clientId);
  return result;
}

export async function updateMemoryRule(ruleId: string, payload: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "memory:manage")) return forbidden();
  const { firmId, userId } = session;
  const parsed = MemoryRuleUpdateSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  const result = await service.updateMemoryRule(firmId, userId, ruleId, parsed.data);
  if (result.ok) {
    revalidatePath("/memory");
    revalidatePath("/clients", "layout");
  }
  return result;
}

export async function deleteMemoryRule(ruleId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "memory:manage")) return forbidden();
  const { firmId, userId } = session;
  const result = await service.deleteMemoryRule(firmId, userId, ruleId);
  if (result.ok) {
    revalidatePath("/memory");
    revalidatePath("/clients", "layout");
  }
  return result;
}

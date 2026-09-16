"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import { retryJob } from "@/server/jobs/queue";
import * as reconcile from "@/server/modules/reconcile/service";
import { listJobs } from "@/server/jobs/service";
import type { JobView } from "@/shared/contracts/job";
import type { ActionResult } from "@/shared/contracts/result";
import type { ImportOutcome, UploadTarget } from "@/shared/contracts/transaction";
import { UploadSchema } from "./schema";
import * as service from "./service";

/**
 * The transport edge of ingestion.
 *
 * The file arrives as multipart FormData. Its name, size and bytes are all
 * request-supplied and are validated by the schema and the content sniff
 * before anything is parsed.
 */

export async function uploadStatement(formData: FormData): Promise<service.ImportResult> {
  const session = await requireSession();
  if (!can(session, "statement:upload")) return forbidden();
  const { firmId, userId } = session;

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload", field: "file" };

  const parsed = UploadSchema.safeParse({
    bankAccountId: formData.get("bankAccountId"),
    filename: file.name,
    size: file.size,
  });
  if (!parsed.success) return invalid(parsed.error) as service.ImportResult;

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await service.importStatement(firmId, userId, parsed.data, bytes);

  revalidatePath("/", "layout");
  return result;
}

/** The outcome of an import once its job has run — the upload dialog's last step. */
export async function getImportOutcome(importId: string): Promise<ImportOutcome | null> {
  const { firmId } = await requireSession();
  return service.getImportOutcome(firmId, importId);
}

/** What the Activity Panel shows when it opens. */
export async function getActivity(): Promise<JobView[]> {
  const { firmId } = await requireSession();
  return listJobs(firmId);
}

/** Clients and their bank accounts, for the upload dialog. */
export async function getUploadTargets(): Promise<UploadTarget[]> {
  const { firmId } = await requireSession();
  return service.listUploadTargets(firmId);
}

/**
 * Queue a reconciliation run for everything not yet coded. The key is
 * bucketed to the minute: a double-click enqueues one run, not two racing
 * over the same PENDING rows. The client is scoped inside the service.
 */
export async function queueReconciliation(clientId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "transaction:update")) return forbidden();
  const job = await reconcile.queueReconciliation(session.firmId, session.userId, clientId);
  if (!job) return { ok: false, error: "Client not found" };
  return { ok: true, id: job.jobId };
}

/** A person's retry of a job that ran out of attempts. */
export async function retryFailedJob(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "statement:upload")) return forbidden();
  const ok = await retryJob(session.firmId, jobId);
  return ok ? { ok: true, id: jobId } : { ok: false, error: "That job cannot be retried" };
}

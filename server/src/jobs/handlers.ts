import "server-only";

import { processImport } from "@/server/modules/ingest/service";
import { runEngine } from "@/server/modules/reconcile/engine";
import { syncFeedConnection } from "@/server/modules/banking/feed-sync";
import type { StageReporter } from "./queue";

/**
 * What each job type does. One place, so the in-process runner and the
 * BullMQ worker cannot disagree about it.
 */

export interface JobContext {
  id: string;
  firmId: string;
  clientId: string | null;
  inputReference: string | null;
  createdById: string | null;
}

export type JobHandler = (job: JobContext, report: StageReporter) => Promise<void>;

export const HANDLERS = {
  IMPORT_STATEMENT: async (job, report) => {
    if (!job.inputReference) throw new Error("Import job has no import id");
    await processImport(job.firmId, job.createdById, job.inputReference, report);
  },
  RECONCILE_CLIENT: async (job, report) => {
    if (!job.clientId) throw new Error("Reconcile job has no client");
    await report("RECONCILING");
    const stats = await runEngine(job.firmId, job.createdById, job.clientId);
    await report("COMPLETED", { message: JSON.stringify(stats) });
  },
  SYNC_BANK_FEED: async (job, report) => {
    if (!job.inputReference) throw new Error("Feed sync job has no connection id");
    // A person pressing "Sync now" always has a session, so a job with no
    // creator is one the webhook enqueued. That distinction is what the
    // FeedSyncRun trigger records, and it is the only signal that survives
    // into the worker process.
    await syncFeedConnection(job.firmId, job.createdById, job.inputReference, report, {
      trigger: job.createdById ? "MANUAL" : "WEBHOOK",
    });
  },
} satisfies Record<string, JobHandler>;

export type JobType = keyof typeof HANDLERS;

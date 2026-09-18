import "server-only";

import { db } from "@/server/core/db";
import type { JobStatus, Prisma } from "@/generated/prisma";
import { HANDLERS, type JobType } from "./handlers";

/**
 * Background jobs, with every stage persisted.
 *
 * A job is a row first. Enqueueing writes the row (its idempotency key makes
 * a double submit a no-op) and then dispatches it, by one of three routes in
 * this order:
 *
 *   BullMQ      `REDIS_URL` is set and a worker is running (`npm run worker`).
 *   HTTP        A serverless host — Vercel — where a background timer does
 *               not survive the response. See `runnerUrl` below.
 *   In-process  A timer on the next tick. The local default: one long-lived
 *               `next dev` process, no infrastructure, the same stage events.
 *
 * Progress is read from `JobEvent` rows, never from memory, so a person can
 * navigate away and come back to accurate state, and the SSE route can serve
 * any process. Retries back off and stop at `maxAttempts`; a job that still
 * fails is DEAD and stays visible, retryable by a person.
 *
 * See .claude/skills/jobs-and-audit/SKILL.md.
 */

export interface EnqueueInput {
  type: JobType;
  firmId: string;
  clientId?: string | null;
  inputReference?: string | null;
  idempotencyKey: string;
  createdById?: string | null;
}

export type StageReporter = (
  stage: string,
  detail?: { processed?: number; total?: number; message?: string },
) => Promise<void>;

export const STAGES = [
  "UPLOADING",
  "FILE_VALIDATION",
  "PARSING",
  "TRANSACTIONS_SAVED",
  "DEDUPLICATING",
  "RECONCILING",
  "GST_PROCESSING",
  "FINALIZING",
  "COMPLETED",
  "FAILED",
] as const;

const BACKOFF_MS = [2_000, 10_000, 60_000];

/**
 * A job that failed on its input, not on the world: an empty file, a
 * malformed statement. Retrying cannot help, so it goes straight to DEAD
 * with a code that says so, instead of burning three attempts to learn the
 * same thing. Still visible, still retryable by a person after they fix it.
 */
export class TerminalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalJobError";
  }
}

/** A RUNNING job older than this with no completion is one whose process died. */
const STALE_RUNNING_MS = 30 * 60_000;

/**
 * Jobs stuck RUNNING because the process that ran them was frozen or killed
 * mid-flight. Nothing else would ever clear them: the runner refuses to
 * start a RUNNING job, and retry accepts only DEAD or FAILED. Marked FAILED
 * with a code that says why, so they show in the Activity Panel and a person
 * can retry them. Called before a run and when the panel lists jobs.
 */
export async function reapStaleJobs(firmId?: string): Promise<number> {
  const { count } = await db.job.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
      ...(firmId ? { firmId } : {}),
    },
    data: {
      status: "FAILED",
      errorCode: "STALE_RUNNING",
      errorMessage: "The process running this job stopped before it finished. Retry it.",
    },
  });
  return count;
}

export async function enqueue(input: EnqueueInput): Promise<{ id: string; existed: boolean }> {
  const existing = await db.job.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return { id: existing.id, existed: true };

  const job = await db.job.create({
    data: {
      firmId: input.firmId,
      clientId: input.clientId ?? null,
      type: input.type,
      inputReference: input.inputReference ?? null,
      idempotencyKey: input.idempotencyKey,
      createdById: input.createdById ?? null,
    },
    select: { id: true },
  });
  await dispatch(job.id, 0);
  return { id: job.id, existed: false };
}

/**
 * The secret the dispatcher signs an HTTP hand-off with and the runner route
 * checks. `AUTH_SECRET` is the fallback because it is already required, is
 * already identical across every invocation of one deployment, and never
 * leaves the server — so the HTTP route needs no new configuration to be
 * safe. `JOB_RUNNER_SECRET` overrides it when the two should not be the same
 * value.
 */
export function jobRunnerSecret(): string | null {
  return process.env.JOB_RUNNER_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || null;
}

/**
 * Where a job runs when there is no worker and no timer that outlives the
 * response.
 *
 * On Vercel the function that served the upload is frozen the moment its
 * response ends, so a `setTimeout` job is not merely delayed — it stops
 * wherever it had got to, mid-stage, with the row left RUNNING. An import
 * reliably reached "Transactions saved" (fast, still inside the request's
 * own window) and died in "Coding transactions", which is a minute or more
 * of AI calls. Observed, not theorised.
 *
 * The fix is to give the job an invocation of its own: POST to a route that
 * answers immediately and finishes the work under `after()`, with its own
 * `maxDuration`. `VERCEL_URL` is this exact deployment, so the job runs the
 * same code that enqueued it; `JOB_RUNNER_URL` overrides for a host that
 * needs one (a stable domain, a preview that cannot self-call).
 *
 * Null on a long-lived host, which is what selects the in-process timer.
 */
function runnerUrl(): string | null {
  const explicit = process.env.JOB_RUNNER_URL?.trim();
  const host = process.env.VERCEL_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = explicit || (host ? `https://${host}` : null);
  return base ? `${base.replace(/\/+$/, "")}/api/jobs/run` : null;
}

/** A job that could not be handed to a runner at all. Visible, not silent. */
async function markUndispatchable(jobId: string, detail: string): Promise<void> {
  await report(jobId, "FAILED", { message: `${detail} — fix the configuration and retry` });
  await db.job.update({
    where: { id: jobId },
    data: { status: "DEAD", errorCode: "NOT_DISPATCHED", errorMessage: detail.slice(0, 500), completedAt: new Date() },
  });
}

async function dispatch(jobId: string, delayMs: number): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    const { Queue } = await import("bullmq");
    const queue = new Queue("ledgerly", { connection: { url: redisUrl } });
    await queue.add("run", { jobId }, { jobId: `${jobId}:${Date.now()}`, delay: delayMs, removeOnComplete: true });
    await queue.close();
    return;
  }

  const url = runnerUrl();
  if (url) {
    const secret = jobRunnerSecret();
    if (!secret) {
      await markUndispatchable(jobId, "Neither JOB_RUNNER_SECRET nor AUTH_SECRET is set, so this host cannot start a job");
      return;
    }
    // A preview deployment sits behind Vercel Authentication, which would
    // answer the self-call with a login page rather than the route.
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    try {
      // The runner answers before it does the work, so this awaits a
      // handshake and not a job: the caller is still the upload request.
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-job-secret": secret,
          ...(bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "false" } : {}),
        },
        body: JSON.stringify({ jobId, delayMs }),
      });
      if (!response.ok) {
        await markUndispatchable(jobId, `The job runner at ${url} answered ${response.status}`);
      }
    } catch (error) {
      await markUndispatchable(jobId, `The job runner at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  // In-process: the same worker code, on this server, after the response.
  setTimeout(() => {
    void runJob(jobId).catch((error: unknown) => {
      // The row is gone — a test purged its firm, or the job was removed —
      // so there is nothing to run and nothing to report against.
      if ((error as { code?: string })?.code === "P2025") return;
      console.error(`[jobs] ${jobId} crashed`, error);
    });
  }, delayMs).unref?.();
}

/** Record a stage. Progress is derived so the panel never has to compute it. */
async function report(jobId: string, stage: string, detail?: { processed?: number; total?: number; message?: string }) {
  const index = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const progress =
    detail?.total && detail.total > 0 && detail.processed !== undefined
      ? Math.round((detail.processed / detail.total) * 100)
      : index >= 0
        ? Math.round((index / (STAGES.length - 2)) * 100)
        : 0;
  await db.$transaction([
    db.jobEvent.create({
      data: {
        jobId,
        stage,
        processed: detail?.processed ?? 0,
        total: detail?.total ?? 0,
        message: detail?.message ?? null,
      },
    }),
    db.job.update({ where: { id: jobId }, data: { currentStage: stage, progress: Math.min(100, progress) } }),
  ]);
}

/** Run one job to completion. Called by the in-process runner and by the BullMQ worker. */
export async function runJob(jobId: string): Promise<void> {
  await reapStaleJobs();
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status === "COMPLETED" || job.status === "RUNNING") return;

  const handler = HANDLERS[job.type as JobType];
  if (!handler) {
    await db.job.update({
      where: { id: jobId },
      data: { status: "DEAD", errorCode: "UNKNOWN_TYPE", errorMessage: `No handler for ${job.type}`, completedAt: new Date() },
    });
    return;
  }

  await db.job.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: job.startedAt ?? new Date(), attempts: { increment: 1 } },
  });

  const reporter: StageReporter = (stage, detail) => report(jobId, stage, detail);

  try {
    await handler(
      {
        id: job.id,
        firmId: job.firmId,
        clientId: job.clientId,
        inputReference: job.inputReference,
        createdById: job.createdById,
      },
      reporter,
    );
    await db.job.update({
      where: { id: jobId },
      data: { status: "COMPLETED", progress: 100, currentStage: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const attempts = job.attempts + 1;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const terminal = error instanceof TerminalJobError;
    const dead = terminal || attempts >= job.maxAttempts;
    await report(jobId, "FAILED", {
      message: terminal ? `${message} — fix the input and retry` : dead ? `${message} — no retries left` : `${message} — retrying`,
    });
    await db.job.update({
      where: { id: jobId },
      data: {
        status: dead ? "DEAD" : "FAILED",
        errorCode: terminal ? "VALIDATION" : dead ? "RETRIES_EXHAUSTED" : "FAILED",
        errorMessage: message,
        completedAt: dead ? new Date() : null,
      },
    });
    if (!dead) await dispatch(jobId, BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!);
  }
}

/** A person's retry of a DEAD job. Resets the attempt budget. */
export async function retryJob(firmId: string, jobId: string): Promise<boolean> {
  const job = await db.job.findFirst({ where: { id: jobId, firmId }, select: { id: true, status: true } });
  if (!job || (job.status !== "DEAD" && job.status !== "FAILED")) return false;
  await db.job.update({
    where: { id: job.id },
    data: { status: "QUEUED", attempts: 0, errorCode: null, errorMessage: null, completedAt: null },
  });
  await dispatch(job.id, 0);
  return true;
}

export type { JobStatus, Prisma };

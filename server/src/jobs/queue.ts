import "server-only";

import { db } from "@/server/core/db";
import type { JobStatus, Prisma } from "@/generated/prisma";
import { HANDLERS, type JobType } from "./handlers";

/**
 * Background jobs, with every stage persisted.
 *
 * A job is a row first. Enqueueing writes the row (its idempotency key makes
 * a double submit a no-op) and then dispatches it: to BullMQ when
 * `REDIS_URL` is set and a worker is running (`pnpm worker`), otherwise to an
 * in-process runner on the next tick — the prototype default, which needs
 * no infrastructure and gives the same stage events.
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

async function dispatch(jobId: string, delayMs: number): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    const { Queue } = await import("bullmq");
    const queue = new Queue("ledgerly", { connection: { url: redisUrl } });
    await queue.add("run", { jobId }, { jobId: `${jobId}:${Date.now()}`, delay: delayMs, removeOnComplete: true });
    await queue.close();
    return;
  }
  // In-process: the same worker code, on this server, after the response.
  setTimeout(() => {
    void runJob(jobId).catch((error) => console.error(`[jobs] ${jobId} crashed`, error));
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
    const dead = attempts >= job.maxAttempts;
    await report(jobId, "FAILED", { message: dead ? `${message} — no retries left` : `${message} — retrying` });
    await db.job.update({
      where: { id: jobId },
      data: {
        status: dead ? "DEAD" : "FAILED",
        errorCode: dead ? "RETRIES_EXHAUSTED" : "FAILED",
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

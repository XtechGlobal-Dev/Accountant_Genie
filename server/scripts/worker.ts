/**
 * The BullMQ worker. Run alongside the app when `REDIS_URL` is set:
 *
 *   pnpm worker
 *
 * Every job's logic lives in `server/jobs/handlers.ts`; this process only
 * pulls ids off the queue and hands them to `runJob`, the same function the
 * in-process runner uses when there is no Redis.
 */
import { Worker } from "bullmq";

process.loadEnvFile(".env");

const url = process.env.REDIS_URL?.trim();
if (!url) {
  console.error("REDIS_URL is not set. Without Redis, jobs run in-process and no worker is needed.");
  process.exit(1);
}

// Loaded lazily so `server-only` is imported under the worker's own module condition.
const { runJob } = await import("../src/jobs/queue.js");

const worker = new Worker(
  "ledgerly",
  async (job) => {
    await runJob(String(job.data.jobId));
  },
  { connection: { url }, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("completed", (job) => console.info(`[worker] done ${job.data.jobId}`));
worker.on("failed", (job, error) => console.error(`[worker] failed ${job?.data.jobId}`, error));
console.info("[worker] listening");

import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { jobRunnerSecret, runJob } from "@/server/jobs/queue";

/**
 * POST /api/jobs/run — run one queued job in an invocation of its own.
 *
 * Only a serverless host reaches this route. A long-lived server runs its
 * jobs on an in-process timer and a Redis deployment runs them on the worker;
 * both leave this endpoint unused. On Vercel neither exists: the function
 * that served the upload is frozen when its response ends, taking the job
 * with it mid-stage. See `runnerUrl` in `server/src/jobs/queue.ts`.
 *
 * The answer is sent first and the work happens under `after()`, so the
 * dispatcher waits for a handshake rather than for a job. The platform keeps
 * this invocation alive for the callback, up to `maxDuration` below.
 *
 * There is no session here — the caller is the server, not a person — so the
 * shared secret IS the authorisation. Tenancy is unaffected either way: a job
 * row carries its own firm, and `runJob` never widens it.
 */
export const dynamic = "force-dynamic";

/**
 * The coding stage is two AI calls over the file, which measured ~80s for a
 * 31-row statement. 300s is the default and the ceiling on Vercel's Hobby
 * plan, and the default on Pro, where a route may ask for more. A statement
 * large enough to exceed it needs the work split across invocations, or the
 * BullMQ worker — see the note in `docs/DEPLOYMENT.md`.
 */
export const maxDuration = 300;

/** A retry's backoff, slept off inside the new invocation rather than lost. */
const MAX_DELAY_MS = 60_000;

/** Equal-length digests, so the comparison leaks neither length nor prefix. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = jobRunnerSecret();
  if (!expected) return new Response("Job runner is not configured", { status: 503 });
  if (!secretMatches(request.headers.get("x-job-secret") ?? "", expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const jobId = (body as { jobId?: unknown })?.jobId;
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return new Response("Bad request", { status: 400 });
  }
  const requested = Number((body as { delayMs?: unknown })?.delayMs);
  const delayMs = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), MAX_DELAY_MS) : 0;

  after(async () => {
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Refuses a job that is already RUNNING or COMPLETED, so a repeated
      // hand-off — a retried dispatch, a duplicate delivery — is a no-op.
      await runJob(jobId);
    } catch (error) {
      // The row is gone: a purged firm, a deleted job. Nothing to report against.
      if ((error as { code?: string })?.code === "P2025") return;
      console.error(`[jobs] ${jobId} crashed`, error);
    }
  });

  return Response.json({ accepted: true, jobId });
}

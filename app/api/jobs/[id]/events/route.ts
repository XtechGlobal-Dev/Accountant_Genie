import { getSession } from "@/server/core/session";
import { eventsSince, findOwnedJob } from "@/server/jobs/service";

/**
 * GET /api/jobs/[id]/events — a job's stage events as Server-Sent Events.
 *
 * Reads persisted rows on a short poll and streams each new one; closes when
 * the job reaches a terminal state. Ownership is checked through the firm in
 * the session, so another firm's job id yields 404 and never a stream.
 */
export const dynamic = "force-dynamic";

const POLL_MS = 1_000;
const MAX_MS = 15 * 60 * 1_000;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const job = await findOwnedJob(session.firmId, id);
  if (!job) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      let since: Date | null = null;
      const startedAt = Date.now();
      try {
        while (!closed && Date.now() - startedAt < MAX_MS) {
          const events = await eventsSince(id, since);
          for (const event of events) {
            send("stage", event);
            since = new Date(event.at);
          }
          const current = await findOwnedJob(session.firmId, id);
          if (!current || current.status === "COMPLETED" || current.status === "DEAD") {
            send("done", { status: current?.status ?? "COMPLETED", progress: current?.progress ?? 100 });
            break;
          }
          if (current.status === "FAILED") send("retrying", { status: current.status });
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

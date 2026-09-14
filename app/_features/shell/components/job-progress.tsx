"use client";

/**
 * Live progress for one background job, over Server-Sent Events.
 *
 * Subscribes to `/api/jobs/[id]/events`, lists each stage as it lands and
 * calls `onDone` when the job reaches a terminal state. Progress comes from
 * persisted rows on the server, so reopening this component after a page
 * change shows the same history.
 */

import { useEffect, useState } from "react";
import type { JobEventView, JobStatusKind } from "@/shared/contracts/job";
import { Icon } from "@/ui/icons";
import { cx } from "@/ui/primitives";

export const STAGE_LABELS: Record<string, string> = {
  UPLOADING: "Uploading",
  FILE_VALIDATION: "Validating file",
  PARSING: "Reading the statement",
  DEDUPLICATING: "Checking for duplicates",
  TRANSACTIONS_SAVED: "Transactions saved",
  RECONCILING: "Coding transactions",
  GST_PROCESSING: "Computing GST",
  FINALIZING: "Finishing",
  COMPLETED: "Complete",
  FAILED: "Failed",
};

export function JobProgress({ jobId, onDone }: { jobId: string; onDone?: (status: JobStatusKind) => void }) {
  const [events, setEvents] = useState<JobEventView[]>([]);
  const [status, setStatus] = useState<JobStatusKind>("RUNNING");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.addEventListener("stage", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as JobEventView;
      setEvents((current) => [...current, event]);
      setProgress(event.progress);
      setStatus(event.status);
    });
    source.addEventListener("done", (message) => {
      const data = JSON.parse((message as MessageEvent).data) as { status: JobStatusKind; progress: number };
      setStatus(data.status);
      setProgress(data.progress);
      source.close();
      onDone?.(data.status);
    });
    source.onerror = () => {
      // The stream closes itself on completion; anything else is a dropped
      // connection, and the browser reconnects on its own.
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const last = events.at(-1);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-2 overflow-hidden rounded-full bg-sunken">
        <div
          className={cx("h-full rounded-full transition-[width] duration-500", status === "DEAD" ? "bg-negative" : "bg-accent-gradient")}
          style={{ width: `${Math.max(progress, 3)}%` }}
        />
      </div>
      <ol className="flex flex-col gap-1.5 text-sm">
        {events.map((event, index) => {
          const isLast = index === events.length - 1;
          const failed = event.stage === "FAILED";
          return (
            <li key={`${event.at}-${index}`} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
                {failed ? (
                  <Icon name="x-circle" className="size-4 text-negative" />
                ) : isLast && status === "RUNNING" ? (
                  <span className="size-2.5 animate-pulse rounded-full bg-accent" />
                ) : (
                  <Icon name="check-circle" className="size-4 text-positive" />
                )}
              </span>
              <span className={cx("min-w-0", failed ? "text-negative-ink" : isLast ? "text-ink" : "text-ink-2")}>
                {STAGE_LABELS[event.stage] ?? event.stage}
                {event.total > 0 ? (
                  <span className="figure ml-2 text-xs text-ink-3">
                    {event.processed.toLocaleString("en-AU")} / {event.total.toLocaleString("en-AU")}
                  </span>
                ) : null}
                {event.message && event.stage !== "COMPLETED" ? (
                  <span className="block text-xs text-ink-3">{event.message}</span>
                ) : null}
              </span>
            </li>
          );
        })}
        {events.length === 0 ? <li className="text-ink-3">Waiting for the job to start…</li> : null}
      </ol>
      {last?.stage === "FAILED" && status !== "DEAD" ? (
        <p className="text-xs text-warning-ink">Retrying automatically.</p>
      ) : null}
    </div>
  );
}

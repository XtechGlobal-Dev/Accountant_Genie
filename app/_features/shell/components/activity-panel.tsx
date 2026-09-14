"use client";

/**
 * Activity Panel — background jobs, live, and the upload entry point.
 *
 * Lists the firm's recent jobs from persisted rows; a running job streams
 * its stages over SSE. A job that ran out of retries is shown as dead with
 * a retry button — never silently lost.
 *
 * Opened through a window event rather than a prop so any control on the page
 * can raise it without the shell threading state down to it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getActivity, retryFailedJob } from "@/server/modules/ingest/actions";
import type { JobView } from "@/shared/contracts/job";
import { shortDate } from "@/shared/format";
import { UploadStatementModal } from "@/features/banking/components/upload-statement-modal";
import { JobProgress, STAGE_LABELS } from "@/features/shell/components/job-progress";
import { Icon } from "@/ui/icons";
import { Portal } from "@/ui/portal";
import { Badge, Button, EmptyState, cx, inputClass } from "@/ui/primitives";

const OPEN_EVENT = "ledgerly:open-activity";

export function openActivityPanel() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function tone(status: JobView["status"]): "positive" | "warning" | "negative" | "neutral" {
  if (status === "COMPLETED") return "positive";
  if (status === "DEAD") return "negative";
  if (status === "FAILED") return "warning";
  return "warning";
}

export function ActivityPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JobView[] | null>(null);
  const [query, setQuery] = useState("");
  const [upload, setUpload] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    function onOpen() {
      setOpen((value) => !value);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getActivity()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, upload, refresh]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (item) =>
      !needle ||
      item.title.toLowerCase().includes(needle) ||
      (item.clientName ?? "").toLowerCase().includes(needle) ||
      (item.subtitle ?? "").toLowerCase().includes(needle),
  );

  return (
    <Portal>
      <div
        className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm animate-fade-in lg:bg-transparent lg:backdrop-blur-0"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        aria-label="Activity"
        className={cx(
          "card fixed inset-y-4 right-4 z-50 flex w-[24rem] max-w-[calc(100vw-2rem)]",
          "flex-col overflow-hidden rounded-2xl shadow-pop animate-pop-in",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
            <p className="text-xs text-ink-3">Imports, feed syncs and reconciliation runs</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close activity panel"
            className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="border-b border-rule p-3">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files, banks, clients…"
              aria-label="Search activity"
              className={cx(inputClass, "h-10 pl-9 text-[13px]")}
            />
          </div>
        </div>

        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          {items === null ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyState
                icon="inbox"
                title={needle ? "Nothing matches" : "No activity yet"}
                body={needle ? "Try a file name, a client or a bank account." : "Upload a bank statement and its import, coding and posting stages will appear here."}
                className="border-0 bg-transparent shadow-none"
              />
            </div>
          ) : (
            <ul className="divide-y divide-rule-soft">
              {visible.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {item.clientId ? (
                        <Link
                          href={`/clients/${item.clientId}/transactions`}
                          onClick={() => setOpen(false)}
                          className="block truncate text-sm font-medium text-ink hover:text-accent"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                      )}
                      <p className="truncate text-xs text-ink-3">
                        {[item.clientName, item.subtitle].filter(Boolean).join(" · ") || item.type}
                      </p>
                    </div>
                    <Badge tone={tone(item.status)}>
                      {item.status === "QUEUED"
                        ? "Queued"
                        : item.status === "RUNNING"
                          ? (STAGE_LABELS[item.currentStage ?? ""] ?? "Running")
                          : item.status === "DEAD"
                            ? "Failed"
                            : item.status === "FAILED"
                              ? "Retrying"
                              : "Complete"}
                    </Badge>
                  </div>
                  {item.status === "RUNNING" || item.status === "QUEUED" ? (
                    <div className="mt-2">
                      <JobProgress jobId={item.id} onDone={() => setRefresh((n) => n + 1)} />
                    </div>
                  ) : (
                    <p className="figure mt-1.5 text-xs text-ink-2">
                      {shortDate(item.createdAt)}
                      {item.attempts > 1 ? ` · ${item.attempts} attempts` : ""}
                    </p>
                  )}
                  {item.errorMessage ? (
                    <p className="mt-1 text-xs leading-relaxed text-negative-ink">{item.errorMessage}</p>
                  ) : null}
                  {item.status === "DEAD" ? (
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="refresh"
                        onClick={async () => {
                          await retryFailedJob(item.id);
                          setRefresh((n) => n + 1);
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-rule p-3">
          <Button variant="secondary" icon="upload" className="w-full" onClick={() => setUpload(true)}>
            Upload statement
          </Button>
        </div>
      </aside>

      {upload ? <UploadStatementModal onClose={() => setUpload(false)} /> : null}
    </Portal>
  );
}

"use client";

/**
 * Run the reconciliation engine for a client from the firm-wide screen.
 * The run is a background job; progress shows in the Activity Panel.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { queueReconciliation } from "@/server/modules/ingest/actions";
import { openActivityPanel } from "@/features/shell/components/activity-panel";
import type { ClientQueueRow } from "@/shared/contracts/dashboard";
import { Icon } from "@/ui/icons";
import { Alert, Avatar, Badge, Button, Card, CardHeader, buttonClass, cx } from "@/ui/primitives";

export function ReconcileList({ rows }: { rows: ClientQueueRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "positive" | "negative"; text: string } | null>(null);

  async function run(row: ClientQueueRow) {
    setBusy(row.clientId);
    const result = await queueReconciliation(row.clientId);
    if (result.ok) {
      setNotice({ tone: "positive", text: `Reconciliation queued for ${row.name}. Progress shows in the Activity Panel.` });
      openActivityPanel();
    } else {
      setNotice({ tone: "negative", text: result.error });
    }
    startTransition(() => router.refresh());
    setBusy(null);
  }

  async function runAll() {
    const targets = rows.filter((row) => row.notCoded > 0);
    setBusy("all");
    let queued = 0;
    for (const row of targets) {
      const result = await queueReconciliation(row.clientId);
      if (result.ok) queued += 1;
    }
    setNotice({ tone: "positive", text: `Reconciliation queued for ${queued} client${queued === 1 ? "" : "s"}.` });
    openActivityPanel();
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const pending = rows.filter((row) => row.notCoded > 0);

  return (
    <Card>
      <CardHeader
        title="Clients"
        description={pending.length > 0 ? `${pending.length} client${pending.length === 1 ? "" : "s"} with uncoded transactions.` : "Nothing waiting to be coded."}
        action={
          pending.length > 1 ? (
            <Button icon="sparkles" disabled={busy !== null} onClick={runAll}>
              Reconcile all ({pending.length})
            </Button>
          ) : null
        }
      />
      {notice ? (
        <div className="px-5 pt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th className="w-36 text-right">Not coded</th>
            <th className="w-36 text-right">Awaiting review</th>
            <th className="w-36">Status</th>
            <th className="w-48 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.clientId}>
              <td>
                <Link href={`/clients/${row.clientId}`} className="flex items-center gap-2.5 font-semibold text-ink hover:text-accent">
                  <Avatar name={row.name} size="md" />
                  {row.name}
                </Link>
              </td>
              <td className={cx("figure text-right", row.notCoded > 0 ? "font-bold text-ink" : "text-ink-2")}>{row.notCoded.toLocaleString("en-AU")}</td>
              <td className="figure text-right text-ink-2">{row.awaitingReview.toLocaleString("en-AU")}</td>
              <td>
                {row.notCoded > 0 ? (
                  <Badge tone="accent" dot>
                    Ready to run
                  </Badge>
                ) : row.awaitingReview > 0 ? (
                  <Badge tone="warning" dot>
                    Needs review
                  </Badge>
                ) : (
                  <Badge tone="positive" dot>
                    Up to date
                  </Badge>
                )}
              </td>
              <td className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  {row.awaitingReview > 0 ? (
                    <Link href={`/clients/${row.clientId}/transactions`} className={buttonClass({ variant: row.notCoded > 0 ? "secondary" : "soft", size: "sm" })}>
                      Review
                      <Icon name="arrow-right" className="size-3.5" />
                    </Link>
                  ) : null}
                  <Button size="sm" variant={row.notCoded > 0 ? "primary" : "secondary"} icon="sparkles" disabled={busy !== null} onClick={() => run(row)}>
                    {busy === row.clientId ? "Queuing…" : "Run"}
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

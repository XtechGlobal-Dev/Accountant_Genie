import "server-only";

import { db } from "@/server/core/db";
import type { JobEventView, JobView } from "@/shared/contracts/job";

/** Reads over jobs, scoped by firm. Progress comes from rows, never from memory. */

export async function listJobs(firmId: string, take = 30): Promise<JobView[]> {
  const rows = await db.job.findMany({
    where: { firmId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      currentStage: true,
      clientId: true,
      inputReference: true,
      errorMessage: true,
      attempts: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((id): id is string => id !== null))];
  const importIds = rows.filter((r) => r.type === "IMPORT_STATEMENT" && r.inputReference).map((r) => r.inputReference!);
  const [clients, imports] = await Promise.all([
    clientIds.length
      ? db.client.findMany({ where: { id: { in: clientIds }, firmId }, select: { id: true, businessName: true } })
      : Promise.resolve([]),
    importIds.length
      ? db.statementImport.findMany({
          where: { id: { in: importIds }, bankAccount: { client: { firmId } } },
          select: { id: true, filename: true, rowCount: true, duplicateCount: true, bankAccount: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.businessName]));
  const importById = new Map(imports.map((i) => [i.id, i]));

  return rows.map((row) => {
    const imp = row.inputReference ? importById.get(row.inputReference) : undefined;
    const title =
      row.type === "IMPORT_STATEMENT"
        ? (imp?.filename ?? "Statement import")
        : row.type === "RECONCILE_CLIENT"
          ? "Reconciliation run"
          : row.type === "SYNC_BANK_FEED"
            ? "Bank feed sync"
            : row.type;
    const subtitle = imp
      ? `${imp.bankAccount.name}${imp.rowCount ? ` · ${imp.rowCount.toLocaleString("en-AU")} rows` : ""}${imp.duplicateCount ? ` · ${imp.duplicateCount} duplicates skipped` : ""}`
      : null;
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      currentStage: row.currentStage,
      clientId: row.clientId,
      clientName: row.clientId ? (clientName.get(row.clientId) ?? null) : null,
      title,
      subtitle,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  });
}

export async function findOwnedJob(firmId: string, jobId: string) {
  return db.job.findFirst({ where: { id: jobId, firmId }, select: { id: true, status: true, progress: true } });
}

/** Events after a given time, oldest first — the SSE route's poll. */
export async function eventsSince(jobId: string, after: Date | null): Promise<JobEventView[]> {
  const [job, events] = await Promise.all([
    db.job.findUnique({ where: { id: jobId }, select: { status: true, progress: true } }),
    db.jobEvent.findMany({
      where: { jobId, ...(after ? { createdAt: { gt: after } } : {}) },
      orderBy: { createdAt: "asc" },
      select: { stage: true, processed: true, total: true, message: true, createdAt: true },
    }),
  ]);
  if (!job) return [];
  return events.map((event) => ({
    stage: event.stage,
    processed: event.processed,
    total: event.total,
    message: event.message,
    progress: job.progress,
    status: job.status,
    at: event.createdAt.toISOString(),
  }));
}

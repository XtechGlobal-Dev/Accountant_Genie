import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getStorage } from "@/server/core/storage";
import { TerminalJobError, enqueue, type StageReporter } from "@/server/jobs/queue";
import { runEngine } from "@/server/modules/reconcile/engine";
import type { Prisma } from "@/generated/prisma";
import type { ImportOutcome, UploadTarget } from "@/shared/contracts/transaction";
import { fingerprint } from "./fingerprint";
import { parseStatementCsv, type ParseResult } from "./parse";
import { parseStatementPdfText } from "./parse-pdf";
import { extractPdfText } from "./pdf";
import * as repo from "./repository";
import { sniffStatement, type UploadInput } from "./schema";

/**
 * Upload → validate → store original → [job] parse → deduplicate → save → reconcile.
 *
 * The request does the cheap part — validate the file, keep the original,
 * create the import row — and enqueues a job for the rest. Each stage the
 * job reaches is persisted, so the Activity Panel and the upload dialog read
 * progress from rows, and a person can leave and come back.
 *
 * See .claude/skills/jobs-and-audit/SKILL.md.
 */

/** Plain JSON for a Prisma Json column — interfaces lack the index signature it wants. */
const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function safeName(filename: string): string {
  return filename.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
}

export type ImportResult =
  | { ok: true; importId: string; jobId: string }
  | { ok: false; error: string; field?: string };

export async function importStatement(
  firmId: string,
  userId: string,
  input: UploadInput,
  bytes: Buffer,
): Promise<ImportResult> {
  const account = await repo.findOwnedBankAccount(firmId, input.bankAccountId);
  if (!account) return { ok: false, error: "Bank account not found", field: "bankAccountId" };

  const sniff = sniffStatement(input.filename, bytes);
  if ("error" in sniff) return { ok: false, error: sniff.error, field: "file" };

  // The id is minted here so the original can be stored under it BEFORE the
  // row exists: an import row never points at a file that is not there, and
  // the row and its audit entry are one transaction.
  const importId = randomUUID();
  const key = `${firmId}/imports/${importId}-${safeName(input.filename)}`;
  await getStorage().put(key, bytes, sniff.kind === "pdf" ? "application/pdf" : "text/csv");

  await db.$transaction(async (tx) => {
    await tx.statementImport.create({
      data: {
        id: importId,
        bankAccountId: account.id,
        filename: input.filename,
        fileType: sniff.kind,
        status: "PARSING",
        stage: "FILE_VALIDATION",
        storagePath: key,
        createdById: userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: account.clientId,
      action: "STATEMENT_IMPORTED",
      entityType: "StatementImport",
      entityId: importId,
      after: { filename: input.filename, kind: sniff.kind, bytes: bytes.length, storageKey: key },
    });
  });

  const job = await enqueue({
    type: "IMPORT_STATEMENT",
    firmId,
    clientId: account.clientId,
    inputReference: importId,
    idempotencyKey: `import:${importId}`,
    createdById: userId,
  });

  return { ok: true, importId, jobId: job.id };
}

/** The job body. Runs in-process or in the worker; reports every stage. */
export async function processImport(
  firmId: string,
  userId: string | null,
  importId: string,
  report: StageReporter,
): Promise<void> {
  const row = await db.statementImport.findFirst({
    where: { id: importId, bankAccount: { client: { firmId } } },
    select: {
      id: true,
      fileType: true,
      storagePath: true,
      bankAccountId: true,
      bankAccount: { select: { clientId: true } },
    },
  });
  if (!row) throw new Error("Import not found");
  if (!row.storagePath) throw new Error("Import has no stored file");

  try {
    await report("PARSING");
    await repo.updateImport(importId, { status: "PARSING", stage: "PARSING" });
    const bytes = await getStorage().get(row.storagePath);

    let parsed: ParseResult;
    if (row.fileType === "pdf") {
      const text = await extractPdfText(bytes);
      parsed = parseStatementPdfText(text);
    } else {
      parsed = parseStatementCsv(bytes.toString("utf8"));
    }

    if (parsed.rows.length === 0) {
      const reason = parsed.failed[0]?.reason ?? "No transactions were found in the file";
      await repo.updateImport(importId, {
        status: "FAILED",
        stage: "FAILED",
        error: reason,
        failedRows: asJson(parsed.failed.slice(0, 200)),
        completedAt: new Date(),
      });
      // The file, not the world, is the problem: retrying reads the same bytes.
      throw new TerminalJobError(reason);
    }

    await report("DEDUPLICATING", { processed: 0, total: parsed.rows.length });
    const inserted = await db.$transaction(async (tx) =>
      repo.insertTransactions(
        tx,
        parsed.rows.map((r) => ({
          bankAccountId: row.bankAccountId,
          importId,
          date: r.date,
          description: r.description,
          normalised: r.normalised,
          amountCents: r.amountCents,
          balanceCents: r.balanceCents,
          fingerprint: fingerprint(row.bankAccountId, r.date, r.amountCents, r.normalised),
          status: "PENDING",
        })),
      ),
    );
    const duplicateCount = parsed.rows.length - inserted;
    await report("TRANSACTIONS_SAVED", {
      processed: inserted,
      total: parsed.rows.length,
      message: `${inserted} new, ${duplicateCount} already on file, ${parsed.failed.length} unreadable`,
    });
    await repo.updateImport(importId, {
      status: "RECONCILING",
      stage: "RECONCILING",
      rowCount: parsed.rows.length,
      duplicateCount,
      columnMap: asJson(parsed.columns),
      failedRows: parsed.failed.length > 0 ? asJson(parsed.failed.slice(0, 200)) : undefined,
    });

    // This import's own rows, and only those: see `listPendingTransactionIds`.
    const own = (await repo.listPendingTransactionIds(importId)).map((r) => r.id);
    await report("RECONCILING", { processed: 0, total: own.length });
    const stats = await runEngine(firmId, userId, row.bankAccount.clientId, own, (processed, total, note) =>
      report("RECONCILING", { processed, total, message: note }),
    );
    await report("GST_PROCESSING", { processed: inserted, total: inserted });

    await report("FINALIZING");
    await repo.updateImport(importId, { status: "COMPLETE", stage: "COMPLETED", completedAt: new Date() });
    await report("COMPLETED", {
      processed: inserted,
      total: inserted,
      message: JSON.stringify({
        rowCount: parsed.rows.length,
        insertedCount: inserted,
        duplicateCount,
        failedCount: parsed.failed.length,
        reconcile: stats,
      }),
    });
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await repo.updateImport(importId, { status: "FAILED", stage: "FAILED", error: detail, completedAt: new Date() });
    throw error;
  }
}

/**
 * The rows an import could not read, as CSV, for the person to fix and
 * re-upload. Scoped through the bank account's client to the firm, like the
 * import itself.
 */
export async function failedRowsCsv(firmId: string, importId: string): Promise<{ filename: string; csv: string } | null> {
  const row = await db.statementImport.findFirst({
    where: { id: importId, bankAccount: { client: { firmId } } },
    select: { filename: true, failedRows: true },
  });
  if (!row) return null;
  const failed = Array.isArray(row.failedRows) ? (row.failedRows as { index?: number; reason?: string; raw?: unknown }[]) : [];
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const lines = ["Row,Reason,Raw", ...failed.map((f) => [f.index ?? "", f.reason ?? "", f.raw ?? ""].map(cell).join(","))];
  return { filename: `${row.filename.replace(/\.[^.]+$/, "")}-failed-rows.csv`, csv: lines.join("\r\n") + "\r\n" };
}

/** What an import came to, once its job has finished. */
export async function getImportOutcome(firmId: string, importId: string): Promise<ImportOutcome | null> {
  const row = await db.statementImport.findFirst({
    where: { id: importId, bankAccount: { client: { firmId } } },
    select: { id: true, status: true, rowCount: true, duplicateCount: true, error: true, failedRows: true },
  });
  if (!row) return null;
  const job = await db.job.findFirst({
    where: { firmId, type: "IMPORT_STATEMENT", inputReference: importId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      events: { where: { stage: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1, select: { message: true } },
    },
  });
  let parsedStats: Partial<ImportOutcome> = {};
  const message = job?.events[0]?.message;
  if (message) {
    try {
      parsedStats = JSON.parse(message) as Partial<ImportOutcome>;
    } catch {
      parsedStats = {};
    }
  }
  const failedRows = Array.isArray(row.failedRows) ? row.failedRows.length : 0;
  return {
    importId: row.id,
    jobId: job?.id ?? null,
    status: row.status,
    error: row.error,
    rowCount: parsedStats.rowCount ?? row.rowCount,
    insertedCount: parsedStats.insertedCount ?? Math.max(0, row.rowCount - row.duplicateCount),
    duplicateCount: parsedStats.duplicateCount ?? row.duplicateCount,
    failedCount: parsedStats.failedCount ?? failedRows,
    reconcile: parsedStats.reconcile ?? null,
  };
}

export async function listUploadTargets(firmId: string): Promise<UploadTarget[]> {
  const rows = await repo.listUploadTargets(firmId);
  return rows.map((row) => ({
    clientId: row.id,
    clientName: row.businessName,
    bankAccounts: row.bankAccounts,
  }));
}

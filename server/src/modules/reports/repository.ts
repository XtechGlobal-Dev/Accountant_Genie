import "server-only";

import { db } from "@/server/core/db";

/**
 * The reporting layer reads journal lines and nothing else.
 *
 * Ownership walks entry → client → firm, so a client ID from another tenant
 * yields an empty report rather than someone else's figures. Ranges are
 * half-open `[start, end)` in UTC, matching `server/au/fy.ts`.
 */
/** Every line before `end` — for as-at statements and brought-forward balances. */
export function listLinesUntil(firmId: string, clientId: string, end: Date) {
  return db.journalLine.findMany({
    where: { entry: { clientId, client: { firmId }, date: { lt: end } } },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: {
      accountId: true,
      description: true,
      debitCents: true,
      creditCents: true,
      gstCents: true,
      gstTreatment: true,
      account: { select: { code: true, name: true, type: true } },
      entry: { select: { id: true, date: true, reference: true, description: true } },
    },
  });
}

/** Lines on the accounts a TPAR reports, with the subcontractor each was linked to. */
export function listTparLines(firmId: string, clientId: string, start: Date, end: Date, codes: readonly number[]) {
  return db.journalLine.findMany({
    where: {
      entry: { clientId, client: { firmId }, date: { gte: start, lt: end } },
      account: { code: { in: [...codes] } },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: {
      debitCents: true,
      creditCents: true,
      gstCents: true,
      subcontractorId: true,
      subcontractor: { select: { name: true, abn: true } },
      entry: { select: { id: true, date: true } },
    },
  });
}

export function listLinesInPeriod(firmId: string, clientId: string, start: Date, end: Date) {
  return db.journalLine.findMany({
    where: {
      entry: { clientId, client: { firmId }, date: { gte: start, lt: end } },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    select: {
      accountId: true,
      description: true,
      debitCents: true,
      creditCents: true,
      gstCents: true,
      gstTreatment: true,
      account: { select: { code: true, name: true, type: true } },
      entry: { select: { id: true, date: true, reference: true, description: true } },
    },
  });
}

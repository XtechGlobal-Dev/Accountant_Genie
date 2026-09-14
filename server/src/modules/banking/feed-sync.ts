import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type { StageReporter } from "@/server/jobs/queue";
import { fingerprint } from "@/server/modules/ingest/fingerprint";
import { normaliseDescription } from "@/server/modules/ingest/parse";
import { runEngine } from "@/server/modules/reconcile/engine";
import { feedErrorMessage } from "./fiskil/errors";
import { isDepositAccount } from "./fiskil/normalise";
import { getFeedProvider, type FeedProvider, type FeedTransaction } from "./feed-provider";

/**
 * Pulling transactions from a live feed into the ledger pipeline.
 *
 * A feed row and an uploaded statement row end up in exactly the same place:
 * a `BankTransaction` that the reconciliation engine then codes. There is no
 * second pipeline for feeds, so nothing can be true of an uploaded
 * transaction and false of a fed one.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **Idempotent.** The provider's transaction id is the identity, enforced
 *     by `@@unique([bankAccountId, externalId])`. Re-running a sync, or the
 *     same webhook delivered five times, converges on the same rows.
 *  2. **Never destructive to posted accounting.** A transaction already
 *     carrying a journal entry is NEVER rewritten — CLAUDE.md §6: posted
 *     entries are immutable, corrections are reversals. Upstream changes to
 *     such a row are counted and surfaced, not applied.
 *  3. **Nothing dropped in silence.** Rows the provider sent that could not be
 *     mapped are counted onto the `FeedSyncRun`, so a broken field mapping
 *     shows up as a number rather than as missing money.
 */

/** A runaway cursor can never loop forever. 500 rows a page. */
const MAX_PAGES = 200;

export interface FeedSyncStats {
  runId: string;
  pagesFetched: number;
  accountsSeen: number;
  inserted: number;
  updated: number;
  /** Rows the provider sent that we could not map. */
  rejected: number;
  /** Unsettled authorisations, skipped until the bank posts them. */
  pending: number;
  /** Rows that changed upstream but are already posted, so were left alone. */
  conflicts: number;
}

interface SyncInput {
  firmId: string;
  userId: string | null;
  connectionId: string;
  trigger: "WEBHOOK" | "MANUAL" | "BACKFILL";
  event?: string | null;
  /** YYYY-MM-DD. Omitted means "since the last successful sync". */
  from?: string | null;
  to?: string | null;
}

/**
 * The connection, proved to belong to the firm.
 *
 * Tenancy is part of this query, not a check after it: an id lifted from
 * another firm resolves to nothing and the caller gets "not found".
 */
async function findOwnedConnection(firmId: string, connectionId: string) {
  return db.bankFeedConnection.findFirst({
    where: { id: connectionId, client: { firmId } },
    select: {
      id: true,
      clientId: true,
      externalUserId: true,
      status: true,
      lastSyncedAt: true,
      provider: true,
    },
  });
}

/**
 * Bring every account on this consent into the local table, and return the map
 * from provider account id to our bank account id.
 *
 * The row is a REFERENCE plus a display name. Balances are deliberately absent
 * — Fiskil's guidance is to read them fresh, and a stored balance is a number
 * that silently goes stale and then gets reported.
 */
async function syncAccounts(
  provider: FeedProvider,
  clientId: string,
  connectionId: string,
  externalUserId: string,
): Promise<Map<string, string>> {
  const accounts = await provider.listAccounts(externalUserId);
  const byExternalId = new Map<string, string>();

  for (const account of accounts) {
    const row = await db.bankAccount.upsert({
      where: { clientId_externalAccountId: { clientId, externalAccountId: account.externalId } },
      // A name the accountant edited is theirs to keep, so only provenance and
      // freshness are refreshed on an account we already hold.
      update: {
        feedConnectionId: connectionId,
        feedProductCategory: account.productCategory,
        feedLastSyncedAt: new Date(),
      },
      create: {
        clientId,
        name: account.name,
        kind: account.kind,
        source: "FEED",
        accountMask: account.mask,
        externalAccountId: account.externalId,
        feedConnectionId: connectionId,
        feedProductCategory: account.productCategory,
        feedLastSyncedAt: new Date(),
      },
      select: { id: true },
    });
    byExternalId.set(account.externalId, row.id);
  }

  // A client needs a Cash at Bank account or the balance sheet has no bank
  // line at all. Only ever set when none exists, and only ever a DEPOSIT
  // account: a consent routinely includes the client's mortgage, and making a
  // home loan the balance sheet's cash line would report a liability as an
  // asset. If the consent brought in no deposit account, none is chosen —
  // the accountant picks one, which is the correct answer to an ambiguous
  // case. See `isDepositAccount`.
  const existing = await db.bankAccount.count({ where: { clientId, isCashAtBank: true } });
  if (existing === 0) {
    const eligible = accounts.filter((account) => isDepositAccount(account.productCategory));
    const first = eligible[0];
    if (first) {
      const row = byExternalId.get(first.externalId);
      if (row) await db.bankAccount.update({ where: { id: row }, data: { isCashAtBank: true } });
    }
  }

  return byExternalId;
}

interface WriteResult {
  inserted: number;
  updated: number;
  conflicts: number;
}

/**
 * Write one page of transactions.
 *
 * Batched deliberately: a page is 500 rows, and a per-row round trip to Neon
 * would make a first-time backfill of several years unusable. Two reads
 * establish what already exists, then the writes are partitioned.
 */
async function writePage(
  bankAccountId: string,
  transactions: FeedTransaction[],
): Promise<WriteResult> {
  const rows = transactions.map((transaction) => {
    const normalised = normaliseDescription(transaction.description);
    return {
      transaction,
      normalised,
      // Feed rows carry a fingerprint too, so that a transaction which arrived
      // first by statement upload and later by feed is recognised as the same
      // one instead of being counted twice.
      fingerprint: fingerprint(bankAccountId, transaction.date, transaction.amountCents, normalised),
    };
  });

  const [byExternalId, byFingerprint] = await Promise.all([
    db.bankTransaction.findMany({
      where: { bankAccountId, externalId: { in: rows.map((row) => row.transaction.externalId) } },
      select: { id: true, externalId: true, journalEntryId: true, amountCents: true, date: true },
    }),
    db.bankTransaction.findMany({
      where: { bankAccountId, externalId: null, fingerprint: { in: rows.map((row) => row.fingerprint) } },
      select: { id: true, fingerprint: true, journalEntryId: true },
    }),
  ]);

  const existingByExternalId = new Map(byExternalId.map((row) => [row.externalId!, row]));
  const uploadedByFingerprint = new Map(byFingerprint.map((row) => [row.fingerprint, row]));

  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<() => Promise<unknown>> = [];
  let conflicts = 0;

  for (const { transaction, normalised, fingerprint: hash } of rows) {
    const feedFields = {
      feedCategory: transaction.feedCategory,
      feedSubcategory: transaction.feedSubcategory,
      feedCategoryConfidence: transaction.feedCategoryConfidence,
      feedMerchantCode: transaction.feedMerchantCode,
      feedRaw: transaction.raw as object,
      postedAt: transaction.postedAt,
      executionAt: transaction.executionAt,
    };

    const existing = existingByExternalId.get(transaction.externalId);
    if (existing) {
      // Already posted to the ledger. The amount and date are now accounting
      // history: a correction is a reversal, never an overwrite. Record the
      // drift and leave the row alone.
      if (existing.journalEntryId) {
        if (
          existing.amountCents !== transaction.amountCents ||
          existing.date.getTime() !== transaction.date.getTime()
        ) {
          conflicts += 1;
          continue;
        }
        updates.push(() =>
          db.bankTransaction.update({ where: { id: existing.id }, data: feedFields }),
        );
        continue;
      }
      updates.push(() =>
        db.bankTransaction.update({
          where: { id: existing.id },
          data: {
            date: transaction.date,
            description: transaction.description,
            normalised,
            amountCents: transaction.amountCents,
            fingerprint: hash,
            ...feedFields,
          },
        }),
      );
      continue;
    }

    // The same transaction already here from an uploaded statement. Adopt it —
    // attach the provider id — rather than creating a second copy of one
    // payment. If it is already posted, only the provider metadata is added.
    const uploaded = uploadedByFingerprint.get(hash);
    if (uploaded) {
      updates.push(() =>
        db.bankTransaction.update({
          where: { id: uploaded.id },
          data: { externalId: transaction.externalId, ...feedFields },
        }),
      );
      continue;
    }

    creates.push({
      bankAccountId,
      date: transaction.date,
      description: transaction.description,
      normalised,
      amountCents: transaction.amountCents,
      fingerprint: hash,
      externalId: transaction.externalId,
      status: "PENDING",
      ...feedFields,
    });
  }

  // `skipDuplicates` covers the race where two syncs of the same consent
  // overlap: the unique constraint decides, not the ordering.
  const inserted =
    creates.length === 0
      ? 0
      : (
          await db.bankTransaction.createMany({
            data: creates as never,
            skipDuplicates: true,
          })
        ).count;

  for (const update of updates) await update();

  return { inserted, updated: updates.length, conflicts };
}

/**
 * Pull everything this consent can give us, then reconcile the client.
 *
 * Called by the `SYNC_BANK_FEED` job handler, so progress reaches the Activity
 * Panel through the stage reporter and a failure is retried with backoff by
 * the queue rather than by anything here.
 */
export async function syncFeedConnection(
  firmId: string,
  userId: string | null,
  connectionId: string,
  report: StageReporter,
  options: { trigger?: SyncInput["trigger"]; event?: string | null; from?: string | null } = {},
): Promise<FeedSyncStats> {
  const provider = getFeedProvider();
  if (!provider) throw new Error("No bank feed provider is configured");

  const connection = await findOwnedConnection(firmId, connectionId);
  if (!connection) throw new Error("Feed connection not found");
  if (connection.status === "REVOKED") throw new Error("This consent has been revoked");

  const run = await db.feedSyncRun.create({
    data: {
      clientId: connection.clientId,
      connectionId: connection.id,
      trigger: options.trigger ?? "MANUAL",
      event: options.event ?? null,
    },
    select: { id: true },
  });

  let pagesFetched = 0;
  let inserted = 0;
  let updated = 0;
  let rejected = 0;
  let pending = 0;
  let conflicts = 0;
  let accountsSeen = 0;

  try {
    await report("PARSING", { message: "Reading accounts from the feed" });
    const accountMap = await syncAccounts(
      provider,
      connection.clientId,
      connection.id,
      connection.externalUserId,
    );
    accountsSeen = accountMap.size;

    // Incremental by default. The first sync has no watermark and pulls
    // whatever history the consent covers; later ones start a day before the
    // last success, because a bank can post a transaction with an earlier
    // date after we have already read that day.
    const from =
      options.from ??
      (connection.lastSyncedAt
        ? new Date(connection.lastSyncedAt.getTime() - 86_400_000).toISOString().slice(0, 10)
        : undefined);

    await report("DEDUPLICATING", { message: "Reading transactions" });

    let cursor: string | undefined;
    do {
      const page = await provider.listTransactionPage({
        externalUserId: connection.externalUserId,
        ...(from ? { from } : {}),
        ...(cursor ? { cursor } : {}),
      });
      pagesFetched += 1;
      rejected += page.rejected.length;
      pending += page.pending;

      // Group by account so each write batch hits one bank account, which is
      // what the unique constraints are scoped to.
      const byAccount = new Map<string, FeedTransaction[]>();
      for (const transaction of page.transactions) {
        const bankAccountId = accountMap.get(transaction.externalAccountId);
        // A transaction for an account the consent no longer lists. It has no
        // ledger anchor, so it is counted rather than guessed at.
        if (!bankAccountId) {
          rejected += 1;
          continue;
        }
        const bucket = byAccount.get(bankAccountId);
        if (bucket) bucket.push(transaction);
        else byAccount.set(bankAccountId, [transaction]);
      }

      for (const [bankAccountId, batch] of byAccount) {
        const result = await writePage(bankAccountId, batch);
        inserted += result.inserted;
        updated += result.updated;
        conflicts += result.conflicts;
      }

      await report("TRANSACTIONS_SAVED", { processed: inserted, total: inserted + updated });
      cursor = page.nextCursor;
    } while (cursor && pagesFetched < MAX_PAGES);

    await report("RECONCILING");
    const stats = await runEngine(firmId, userId, connection.clientId);

    await db.$transaction(async (tx) => {
      await tx.feedSyncRun.update({
        where: { id: run.id },
        data: {
          status: "OK",
          pagesFetched,
          rowsInserted: inserted,
          rowsUpdated: updated,
          finishedAt: new Date(),
        },
      });
      await tx.bankFeedConnection.update({
        where: { id: connection.id },
        data: { status: "ACTIVE", lastSyncedAt: new Date(), lastError: null },
      });
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: connection.clientId,
        action: "BANK_FEED_SYNCED",
        entityType: "BankFeedConnection",
        entityId: connection.id,
        after: {
          trigger: options.trigger ?? "MANUAL",
          accounts: accountsSeen,
          inserted,
          updated,
          rejected,
          pending,
          conflicts,
          reconcile: stats ? { ...stats } : null,
        },
      });
    });

    await report("COMPLETED", {
      processed: inserted,
      total: inserted + updated,
      message: JSON.stringify({ inserted, updated, rejected, pending, conflicts, accounts: accountsSeen }),
    });

    return { runId: run.id, pagesFetched, accountsSeen, inserted, updated, rejected, pending, conflicts };
  } catch (error) {
    const message = feedErrorMessage(error).slice(0, 500);
    // Both records are updated even on failure: the run says what arrived
    // before it broke, the connection surfaces the problem on the screen.
    await db.feedSyncRun.update({
      where: { id: run.id },
      data: {
        status: "ERROR",
        error: message,
        pagesFetched,
        rowsInserted: inserted,
        rowsUpdated: updated,
        finishedAt: new Date(),
      },
    });
    await db.bankFeedConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: message },
    });
    throw error;
  }
}

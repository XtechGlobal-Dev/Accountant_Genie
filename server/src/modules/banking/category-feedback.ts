import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getFeedProvider } from "./feed-provider";

/**
 * The outward half of Coding Memory.
 *
 * When an accountant recodes a transaction that arrived on a live feed, the
 * firm has just produced evidence that the provider's own categoriser was
 * wrong. Sending that back makes the next month's feed arrive better
 * categorised, which raises the share of transactions the rules and memory
 * tiers resolve before any AI call — the metric in CLAUDE.md §11.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE. Fiskil's endpoint requires a
 * `secondary_category` that is "a valid secondary category from the Fiskil
 * taxonomy", and that taxonomy is not published anywhere in their
 * documentation — confirmed 2026-09-11 by endpoint reference, full-text
 * search and the Banking domain guide. Inventing a value would mean guessing
 * at a third party's enum and getting silent 400s, or worse, poisoning their
 * model for this client.
 *
 * So we never invent one. We only ever send back a category that FISKIL
 * ITSELF put on some other transaction, which makes validity structural
 * rather than hoped for. Concretely: the category most often seen on the
 * firm's own already-reviewed feed transactions coded to this same account.
 * With no such evidence, we send nothing. Abstention is a correct answer here
 * exactly as it is in the classification pipeline.
 *
 * Nothing here can affect the books. The human has already told the ledger;
 * this is a hint to a third party, and every failure is swallowed.
 */

/** Don't speak for the firm on the strength of one coincidence. */
const MIN_EVIDENCE = 3;

export interface CategoryFeedbackOutcome {
  sent: boolean;
  reason:
    | "sent"
    | "not-a-feed-transaction"
    | "no-provider"
    | "no-evidence"
    | "already-correct"
    | "failed";
}

/**
 * Tell the provider how this firm actually codes this kind of transaction.
 *
 * Safe to call for any transaction: it resolves to a no-op unless the row came
 * from a feed and the firm has a settled, repeated opinion about it.
 */
export async function shareCategoryCorrection(
  firmId: string,
  userId: string | null,
  transactionId: string,
): Promise<CategoryFeedbackOutcome> {
  const provider = getFeedProvider();
  if (!provider) return { sent: false, reason: "no-provider" };

  // Ownership is in the query, as everywhere else.
  const transaction = await db.bankTransaction.findFirst({
    where: { id: transactionId, bankAccount: { client: { firmId } } },
    select: {
      id: true,
      externalId: true,
      feedSubcategory: true,
      accountId: true,
      bankAccount: { select: { clientId: true } },
    },
  });

  // An uploaded statement row has no identity at the provider, so there is
  // nothing to correct.
  if (!transaction?.externalId || !transaction.accountId) {
    return { sent: false, reason: "not-a-feed-transaction" };
  }

  /**
   * What this firm's settled decisions say a transaction coded to this
   * account normally looks like at Fiskil.
   *
   * Scoped to the firm, not the client: the pattern being learned is "this
   * firm codes transactions Fiskil calls X to account Y", which generalises
   * across their clients. Restricted to REVIEWED rows, because a coding no
   * person has signed off is not evidence of anything.
   */
  const evidence = await db.bankTransaction.groupBy({
    by: ["feedSubcategory"],
    where: {
      bankAccount: { client: { firmId } },
      accountId: transaction.accountId,
      status: "REVIEWED",
      excludedAt: null,
      feedSubcategory: { not: null },
      id: { not: transaction.id },
    },
    _count: { _all: true },
    orderBy: { _count: { feedSubcategory: "desc" } },
    take: 1,
  });

  const best = evidence[0];
  if (!best?.feedSubcategory || best._count._all < MIN_EVIDENCE) {
    return { sent: false, reason: "no-evidence" };
  }

  // Fiskil already agrees. Sending would be noise.
  if (best.feedSubcategory === transaction.feedSubcategory) {
    return { sent: false, reason: "already-correct" };
  }

  try {
    await provider.suggestCategory({
      externalTransactionId: transaction.externalId,
      secondaryCategory: best.feedSubcategory,
    });
  } catch (error) {
    // Deliberately swallowed. The ledger is correct without this, and an
    // accountant should never see a recode fail because a third party's
    // categoriser was unreachable.
    console.warn(
      `[fiskil] category feedback for ${transaction.id} failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return { sent: false, reason: "failed" };
  }

  await db.$transaction(async (tx) => {
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: transaction.bankAccount.clientId,
      action: "BANK_FEED_CATEGORY_SHARED",
      entityType: "BankTransaction",
      entityId: transaction.id,
      before: { feedSubcategory: transaction.feedSubcategory },
      after: { feedSubcategory: best.feedSubcategory, evidenceCount: best._count._all },
    });
  });

  return { sent: true, reason: "sent" };
}

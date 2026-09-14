import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { gstFromGross } from "@/server/au/gst";
import * as accountsRepo from "@/server/modules/accounts/repository";
import * as clients from "@/server/modules/clients/repository";
import * as ledgerRepo from "@/server/modules/ledger/repository";
import { postBankTransactionInTx, reversalLines } from "@/server/modules/ledger/service";
import { treatmentAllowedFor } from "@/shared/account-rules";
import type { AccountType } from "@/shared/enums";
import type { ActionResult } from "@/shared/contracts/result";
import type {
  MemoryRuleRow,
  ReconcileStats,
  ReviewSummary,
  TransactionRow,
} from "@/shared/contracts/transaction";
import { runEngine } from "./engine";
import * as repo from "./repository";
import type { ExcludeInput, MemoryRuleUpdateInput, RecodeInput } from "./schema";
import { shareCategoryCorrection } from "@/server/modules/banking/category-feedback";

/**
 * The review workflow: what a person does with what the engine proposed.
 *
 * Accepting a transaction is the only path from a bank row to the ledger, and
 * it runs the same gate the engine ran — an account can be deactivated
 * between coding and acceptance, and the ledger must not find out later.
 */

/** Ledger accounts that stand for a bank account, by kind. */
const BANK_LEDGER_CODE = { BANK: 701, CREDIT_CARD: 804 } as const;

type Row = Awaited<ReturnType<typeof repo.listTransactions>>[number];

function toRow(row: Row): TransactionRow {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    normalised: row.normalised,
    amountCents: row.amountCents,
    balanceCents: row.balanceCents,
    status: row.status,
    needsReview: row.needsReview,
    risk: row.risk,
    source: row.source,
    confidence: row.confidence,
    reasoning: row.reasoning,
    accountId: row.accountId,
    accountCode: row.account?.code ?? null,
    accountName: row.account?.name ?? null,
    gstTreatment: row.gstTreatment,
    gstCents: row.gstCents,
    netCents: row.netCents,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.name,
    importId: row.importId,
    journalEntryId: row.journalEntryId,
    excludedAt: row.excludedAt,
    excludeReason: row.excludeReason,
    memoryRuleId: row.memoryRuleId,
    subcontractorId: row.subcontractorId,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listTransactions(
  firmId: string,
  clientId: string,
): Promise<TransactionRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return (await repo.listTransactions(firmId, client.id)).map(toRow);
}

export async function getReviewSummary(
  firmId: string,
  clientId: string,
): Promise<ReviewSummary | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return repo.summary(firmId, client.id);
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/** Code everything not yet coded for this client. `null` = client not owned. */
export function runReconciliation(
  firmId: string,
  userId: string,
  clientId: string,
): Promise<ReconcileStats | null> {
  return runEngine(firmId, userId, clientId);
}

/* -------------------------------------------------------------------------- */
/* Review actions                                                             */
/* -------------------------------------------------------------------------- */

type CreatableType = Exclude<AccountType, "UNKNOWN">;

/**
 * Recode a transaction by hand. The account is resolved through the client's
 * chart; the treatment defaults to the account's own; GST is recomputed by
 * the engine. Optionally teaches Coding Memory, and re-codes any other open
 * transaction with the same normalised description so the flywheel is felt
 * immediately.
 */
export async function recodeTransaction(
  firmId: string,
  userId: string,
  transactionId: string,
  input: RecodeInput,
): Promise<ActionResult> {
  const t = await repo.findOwnedTransaction(firmId, transactionId);
  if (!t) return { ok: false, error: "Transaction not found" };
  if (t.status === "REVIEWED") {
    return { ok: false, error: "Reopen this transaction before recoding it" };
  }
  if (t.excludedAt) return { ok: false, error: "Restore this transaction before recoding it" };

  const clientId = t.bankAccount.clientId;
  const visible = await accountsRepo.resolveForClient(firmId, clientId, [input.accountId]);
  const account = visible[0];
  if (!account) return { ok: false, error: "Account not found", field: "accountId" };
  if (!account.isActive) return { ok: false, error: `${account.name} is deactivated`, field: "accountId" };
  if (account.type === "UNKNOWN") {
    return { ok: false, error: "Choose a real account, not a holding account", field: "accountId" };
  }

  const treatment = input.gstTreatment ?? account.gstTreatment;
  if (!treatmentAllowedFor(account.type as CreatableType, treatment)) {
    return { ok: false, error: "That tax code does not apply to this account", field: "gstTreatment" };
  }

  const gstRegistered = t.bankAccount.client.gstRegistered;
  const gstCents = gstRegistered ? gstFromGross(t.amountCents, treatment) : 0;
  const pattern = (input.pattern ?? t.normalised).toLowerCase().trim();

  await db.$transaction(async (tx) => {
    let memoryRuleId: string | null = null;

    if (input.remember !== "NONE") {
      const scopeClientId = input.remember === "CLIENT" ? clientId : null;
      const existing = await repo.findMemoryRuleByPattern(firmId, scopeClientId, pattern);
      if (existing) {
        await repo.updateMemoryRule(tx, existing.id, {
          matchType: input.matchType,
          accountId: account.id,
          gstTreatment: treatment,
          evidenceCount: { increment: 1 },
        });
        memoryRuleId = existing.id;
      } else {
        const created = await repo.createMemoryRule(tx, {
          firmId,
          clientId: scopeClientId,
          pattern,
          matchType: input.matchType,
          accountId: account.id,
          gstTreatment: treatment,
          createdById: userId,
        });
        memoryRuleId = created.id;
      }
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: scopeClientId,
        action: existing ? "MEMORY_UPDATED" : "MEMORY_CREATED",
        entityType: "MemoryRule",
        entityId: memoryRuleId,
        after: { pattern, matchType: input.matchType, accountId: account.id, gstTreatment: treatment, scope: input.remember },
      });
    }

    await repo.updateTransaction(tx, t.id, {
      status: "CLASSIFIED",
      accountId: account.id,
      gstTreatment: treatment,
      gstCents,
      netCents: t.amountCents - gstCents,
      source: "MANUAL",
      confidence: 1,
      reasoning: "Coded by hand",
      needsReview: false,
      memoryRuleId,
      subcontractorId: input.subcontractorId || null,
    });

    await recordAudit(tx, {
      firmId,
      userId,
      clientId,
      action: "TRANSACTION_RECODED",
      entityType: "BankTransaction",
      entityId: t.id,
      before: { accountId: t.accountId, gstTreatment: t.gstTreatment, gstCents: t.gstCents },
      after: { accountId: account.id, gstTreatment: treatment, gstCents },
    });
  });

  // Apply the new rule to everything else still open with the same
  // description — the correction should be felt across the whole file.
  if (input.remember !== "NONE") {
    const siblings = await db.bankTransaction.findMany({
      where: {
        bankAccount: { clientId, client: { firmId } },
        id: { not: t.id },
        excludedAt: null,
        status: { in: ["PENDING", "CLASSIFIED"] },
        needsReview: true,
        normalised: input.matchType === "EXACT" ? pattern : { contains: pattern },
      },
      select: { id: true },
    });
    if (siblings.length > 0) {
      await runEngine(firmId, userId, clientId, siblings.map((s) => s.id));
    }
  }

  // A person just disagreed with how this transaction was categorised. If it
  // came from a live feed, tell the provider, so next month's data arrives
  // closer to how this firm actually codes. Awaited rather than fired and
  // forgotten — a detached promise does not reliably survive the response in
  // a serverless runtime — but it swallows every failure internally and
  // no-ops for uploaded rows, so it can neither fail nor slow a recode of a
  // transaction that did not come from a feed.
  await shareCategoryCorrection(firmId, userId, t.id);

  return { ok: true, id: t.id };
}

export interface AcceptOutcome {
  accepted: number;
  skipped: { id: string; reason: string }[];
}

/**
 * Sign off transactions and post them. Each one is validated on its own and
 * either posts or is skipped with a reason — one bad row never blocks the
 * rest, and never corrupts the batch.
 */
export async function acceptTransactions(
  firmId: string,
  userId: string,
  ids: readonly string[],
): Promise<AcceptOutcome> {
  const rows = await repo.findOwnedTransactions(firmId, ids);
  const found = new Map(rows.map((r) => [r.id, r]));
  const outcome: AcceptOutcome = { accepted: 0, skipped: [] };

  const cashAccount = await repo.findSystemAccountByCode(BANK_LEDGER_CODE.BANK);
  const cardAccount = await repo.findSystemAccountByCode(BANK_LEDGER_CODE.CREDIT_CARD);

  for (const id of ids) {
    const t = found.get(id);
    if (!t) {
      outcome.skipped.push({ id, reason: "Not found" });
      continue;
    }
    if (t.status === "REVIEWED") {
      outcome.skipped.push({ id, reason: "Already accepted" });
      continue;
    }
    if (t.excludedAt) {
      outcome.skipped.push({ id, reason: "Excluded" });
      continue;
    }
    if (!t.accountId || !t.account || !t.gstTreatment || t.gstTreatment === "UNALLOCATED" || t.account.type === "UNKNOWN") {
      outcome.skipped.push({ id, reason: "Not coded to a real account yet" });
      continue;
    }
    if (!t.account.isActive) {
      outcome.skipped.push({ id, reason: `${t.account.name} is deactivated` });
      continue;
    }
    if (!treatmentAllowedFor(t.account.type as CreatableType, t.gstTreatment)) {
      outcome.skipped.push({ id, reason: "Tax code does not fit the account" });
      continue;
    }
    if (t.amountCents === 0) {
      outcome.skipped.push({ id, reason: "Zero amount" });
      continue;
    }
    const bankLedger = t.bankAccount.kind === "CREDIT_CARD" ? cardAccount : cashAccount;
    if (!bankLedger) {
      outcome.skipped.push({ id, reason: "Bank ledger account missing — run the seed" });
      continue;
    }

    const accountId = t.accountId;
    const gstTreatment = t.gstTreatment;
    await db.$transaction(async (tx) => {
      const entryId = await postBankTransactionInTx(tx, firmId, userId, {
        clientId: t.bankAccount.clientId,
        date: t.date,
        description: t.description,
        bankLedgerAccountId: bankLedger.id,
        accountId,
        amountCents: t.amountCents,
        gstTreatment,
        gstRegistered: t.bankAccount.client.gstRegistered,
        subcontractorId: t.subcontractorId,
        bankTransactionId: t.id,
      });
      await repo.updateTransaction(tx, t.id, {
        status: "REVIEWED",
        needsReview: false,
        reviewedAt: new Date(),
        reviewedById: userId,
        journalEntryId: entryId,
      });
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: t.bankAccount.clientId,
        action: "TRANSACTION_ACCEPTED",
        entityType: "BankTransaction",
        entityId: t.id,
        after: { journalEntryId: entryId, accountId, gstTreatment },
      });
    });
    outcome.accepted += 1;
  }

  return outcome;
}

/**
 * Take an accepted transaction back for recoding. Its journal is reversed,
 * not deleted — the ledger keeps both entries.
 */
export async function reopenTransaction(
  firmId: string,
  userId: string,
  transactionId: string,
): Promise<ActionResult> {
  const t = await repo.findOwnedTransaction(firmId, transactionId);
  if (!t) return { ok: false, error: "Transaction not found" };
  if (t.status !== "REVIEWED") return { ok: false, error: "This transaction is not accepted" };

  const entry = t.journalEntry;
  await db.$transaction(async (tx) => {
    if (entry && !entry.reversedBy) {
      const reversal = await ledgerRepo.createEntry(tx, {
        clientId: t.bankAccount.clientId,
        date: entry.date,
        reference: null,
        description: `Reversal — reopened: ${t.description}`,
        source: "BANK",
        totalCents: Math.abs(t.amountCents),
        reversesId: entry.id,
        postedById: userId,
        lines: { create: reversalLines(entry.lines) },
      });
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: t.bankAccount.clientId,
        action: "JOURNAL_REVERSED",
        entityType: "JournalEntry",
        entityId: entry.id,
        after: { reversedById: reversal.id, reason: "transaction reopened" },
      });
    }
    await repo.updateTransaction(tx, t.id, {
      status: "CLASSIFIED",
      needsReview: true,
      reviewedAt: null,
      reviewedById: null,
      journalEntryId: null,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: t.bankAccount.clientId,
      action: "TRANSACTION_REOPENED",
      entityType: "BankTransaction",
      entityId: t.id,
      before: { journalEntryId: entry?.id ?? null },
    });
  });

  return { ok: true, id: t.id };
}

/** Exclude from the books — a personal spend, a duplicate. Never deleted. */
export async function excludeTransaction(
  firmId: string,
  userId: string,
  transactionId: string,
  input: ExcludeInput,
): Promise<ActionResult> {
  const t = await repo.findOwnedTransaction(firmId, transactionId);
  if (!t) return { ok: false, error: "Transaction not found" };
  if (t.status === "REVIEWED") return { ok: false, error: "Reopen this transaction before excluding it" };
  if (t.excludedAt) return { ok: true, id: t.id };

  await db.$transaction(async (tx) => {
    await repo.updateTransaction(tx, t.id, {
      excludedAt: new Date(),
      excludeReason: input.reason,
      needsReview: false,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: t.bankAccount.clientId,
      action: "TRANSACTION_EXCLUDED",
      entityType: "BankTransaction",
      entityId: t.id,
      after: { reason: input.reason },
    });
  });
  return { ok: true, id: t.id };
}

export async function restoreTransaction(
  firmId: string,
  userId: string,
  transactionId: string,
): Promise<ActionResult> {
  const t = await repo.findOwnedTransaction(firmId, transactionId);
  if (!t) return { ok: false, error: "Transaction not found" };
  if (!t.excludedAt) return { ok: true, id: t.id };

  await db.$transaction(async (tx) => {
    await repo.updateTransaction(tx, t.id, {
      excludedAt: null,
      excludeReason: null,
      needsReview: t.status === "CLASSIFIED",
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: t.bankAccount.clientId,
      action: "TRANSACTION_RESTORED",
      entityType: "BankTransaction",
      entityId: t.id,
      before: { reason: t.excludeReason },
    });
  });
  return { ok: true, id: t.id };
}

/* -------------------------------------------------------------------------- */
/* Coding Memory                                                              */
/* -------------------------------------------------------------------------- */

type MemoryRowRaw = Awaited<ReturnType<typeof repo.listMemoryRows>>[number];

function toMemoryRow(row: MemoryRowRaw): MemoryRuleRow {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.matchType,
    scope: row.clientId ? "CLIENT" : "FIRM",
    clientId: row.clientId,
    clientName: row.client?.businessName ?? null,
    accountId: row.accountId,
    accountCode: row.account.code,
    accountName: row.account.name,
    gstTreatment: row.gstTreatment,
    hitCount: row.hitCount,
    evidenceCount: row.evidenceCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

/** A client's rules (own + firm-wide shown separately by the page), or the firm's. */
export async function listMemory(firmId: string, clientId?: string): Promise<MemoryRuleRow[] | null> {
  if (clientId) {
    const client = await clients.findOwnedClientId(firmId, clientId);
    if (!client) return null;
    return (await repo.listMemoryForClient(firmId, client.id)).map(toMemoryRow);
  }
  return (await repo.listMemoryRows(firmId)).map(toMemoryRow);
}

export async function updateMemoryRule(
  firmId: string,
  userId: string,
  ruleId: string,
  input: MemoryRuleUpdateInput,
): Promise<ActionResult> {
  const rule = await repo.findOwnedMemoryRule(firmId, ruleId);
  if (!rule) return { ok: false, error: "Rule not found" };

  const visible = rule.clientId
    ? await accountsRepo.resolveForClient(firmId, rule.clientId, [input.accountId])
    : await accountsRepo.resolveForFirm(firmId, [input.accountId]);
  const account = visible[0];
  if (!account || account.type === "UNKNOWN") {
    return { ok: false, error: "Account not found", field: "accountId" };
  }
  if (!treatmentAllowedFor(account.type as CreatableType, input.gstTreatment)) {
    return { ok: false, error: "That tax code does not apply to this account", field: "gstTreatment" };
  }

  const pattern = input.pattern.toLowerCase().trim();
  const clash = await repo.findMemoryRuleByPattern(firmId, rule.clientId, pattern);
  if (clash && clash.id !== rule.id) {
    return { ok: false, error: "Another rule already uses that pattern in this scope", field: "pattern" };
  }

  await db.$transaction(async (tx) => {
    await repo.updateMemoryRule(tx, rule.id, {
      pattern,
      matchType: input.matchType,
      accountId: account.id,
      gstTreatment: input.gstTreatment,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: rule.clientId,
      action: "MEMORY_UPDATED",
      entityType: "MemoryRule",
      entityId: rule.id,
      before: { pattern: rule.pattern, matchType: rule.matchType, accountId: rule.accountId, gstTreatment: rule.gstTreatment },
      after: { pattern, matchType: input.matchType, accountId: account.id, gstTreatment: input.gstTreatment },
    });
  });
  return { ok: true, id: rule.id };
}

export async function deleteMemoryRule(
  firmId: string,
  userId: string,
  ruleId: string,
): Promise<ActionResult> {
  const rule = await repo.findOwnedMemoryRule(firmId, ruleId);
  if (!rule) return { ok: false, error: "Rule not found" };

  await db.$transaction(async (tx) => {
    await repo.deleteMemoryRule(tx, rule.id);
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: rule.clientId,
      action: "MEMORY_DELETED",
      entityType: "MemoryRule",
      entityId: rule.id,
      before: { pattern: rule.pattern, matchType: rule.matchType, accountId: rule.accountId, gstTreatment: rule.gstTreatment },
    });
  });
  return { ok: true, id: rule.id };
}

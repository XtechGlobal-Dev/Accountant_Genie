import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { gstFromGross } from "@/server/au/gst";
import { CODE_INTEREST_CHARGED, CODE_LOAN_PRINCIPAL } from "@/server/au/coa";
import { enqueue } from "@/server/jobs/queue";
import * as accountsRepo from "@/server/modules/accounts/repository";
import * as clients from "@/server/modules/clients/repository";
import * as ledgerRepo from "@/server/modules/ledger/repository";
import { postBankTransactionInTx, reversalLines, type BankAllocation } from "@/server/modules/ledger/service";
import { loanSchedule } from "@/server/modules/loans/amortisation";
import * as loansRepo from "@/server/modules/loans/repository";
import * as subcontractors from "@/server/modules/subcontractors/repository";
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
 *
 * Edits are optimistic: the row version the screen showed travels with the
 * edit, and a stale one is refused with a conflict rather than merged over a
 * colleague's correction.
 */

/** Ledger accounts that stand for a bank account, by kind. */
const BANK_LEDGER_CODE = { BANK: 701, CREDIT_CARD: 804 } as const;

const CONFLICT = "Someone else changed this transaction while you were editing it. Reload and try again.";

class ConflictError extends Error {}

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
    loanId: row.loanId,
    version: row.version,
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

/**
 * Code everything not yet coded for this client — as a background job, never
 * in a request: a run makes AI calls and holds a long transaction, and the
 * Activity Panel is where its progress belongs. The idempotency key is
 * bucketed to the minute so a double-click enqueues one run, not two.
 * `null` = client not owned.
 */
export async function queueReconciliation(
  firmId: string,
  userId: string,
  clientId: string,
  transactionIds?: readonly string[],
): Promise<{ jobId: string; existed: boolean } | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const minute = Math.floor(Date.now() / 60_000);
  const subset = transactionIds && transactionIds.length > 0 ? [...new Set(transactionIds)].sort() : null;
  const job = await enqueue({
    type: "RECONCILE_CLIENT",
    firmId,
    clientId: client.id,
    inputReference: subset ? JSON.stringify(subset) : null,
    idempotencyKey: subset ? `reconcile:${client.id}:subset:${minute}:${subset.length}:${subset[0]}` : `reconcile:${client.id}:${minute}`,
    createdById: userId,
  });
  return { jobId: job.id, existed: job.existed };
}

/** The engine, inline. For scripts and tests; the app enqueues. */
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
 * Recode a transaction by hand. The account, the subcontractor and the loan
 * are each resolved through the client's own records — a request may name
 * three resources and every one of them is ownership-checked. The treatment
 * defaults to the account's own; GST is recomputed deterministically.
 * Optionally teaches Coding Memory, and queues a re-code of any other open
 * transaction with the same normalised description so the flywheel is felt
 * across the whole file.
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
  if (input.version !== undefined && input.version !== t.version) return { ok: false, error: CONFLICT };

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

  // The second and third resources. A subcontractor or loan id from the
  // request is only ever this client's own; anything else is "not found".
  let subcontractorId: string | null = null;
  if (input.subcontractorId) {
    const known = await subcontractors.listOptions(firmId, clientId);
    if (!known.some((s) => s.id === input.subcontractorId)) {
      return { ok: false, error: "Subcontractor not found", field: "subcontractorId" };
    }
    subcontractorId = input.subcontractorId;
  }
  let loanId: string | null = null;
  if (input.loanId) {
    const loan = await loansRepo.findOwned(firmId, input.loanId);
    if (!loan || loan.clientId !== clientId) return { ok: false, error: "Loan not found", field: "loanId" };
    if (account.code !== CODE_LOAN_PRINCIPAL) {
      return { ok: false, error: `A loan repayment is coded to ${CODE_LOAN_PRINCIPAL} Loan Account; the interest split happens when it is accepted`, field: "accountId" };
    }
    loanId = loan.id;
  }

  const gstRegistered = t.bankAccount.client.gstRegistered;
  const gstCents = gstRegistered ? gstFromGross(t.amountCents, treatment) : 0;
  const pattern = (input.pattern ?? t.normalised).toLowerCase().trim();

  try {
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

      const written = await repo.updateTransactionIfVersion(tx, t.id, t.version, {
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
        subcontractorId,
        loanId,
        aiMeta: { tier: "manual", decidedAt: new Date().toISOString() },
      });
      if (written === 0) throw new ConflictError(CONFLICT);

      await recordAudit(tx, {
        firmId,
        userId,
        clientId,
        action: "TRANSACTION_RECODED",
        entityType: "BankTransaction",
        entityId: t.id,
        before: { accountId: t.accountId, gstTreatment: t.gstTreatment, gstCents: t.gstCents, subcontractorId: t.subcontractorId, loanId: t.loanId },
        after: { accountId: account.id, gstTreatment: treatment, gstCents, subcontractorId, loanId },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, error: CONFLICT };
    throw error;
  }

  // Apply the new rule to everything else still open with the same
  // description — as a job, so a common narration on a 10,000-row file is
  // never an unbounded reclassification inside one request.
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
      take: 500,
    });
    if (siblings.length > 0) {
      await queueReconciliation(firmId, userId, clientId, siblings.map((s) => s.id));
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

type Acceptable = Awaited<ReturnType<typeof repo.findOwnedTransactions>>[number];

/**
 * How a repayment splits when the transaction is linked to a loan and coded
 * to the loan account: the interest the amortisation schedule expects for
 * the period the repayment falls in, the rest to principal. Deterministic
 * and reproducible from the loan's terms; never expensing the whole payment.
 */
function loanAllocations(t: Acceptable, interestAccountId: string, principalAccountId: string): BankAllocation[] {
  const magnitude = Math.abs(t.amountCents);
  if (!t.loan || t.loan.status !== "ACTIVE") return [{ accountId: principalAccountId, cents: magnitude, gstTreatment: "BAS_EXCLUDED" }];
  const schedule = loanSchedule(t.loan, t.date);
  const due = [...schedule.rows].reverse().find((row) => row.date <= t.date) ?? schedule.rows[0];
  const interest = Math.max(0, Math.min(magnitude, due?.interestCents ?? 0));
  return [
    { accountId: principalAccountId, cents: magnitude - interest, gstTreatment: "BAS_EXCLUDED", description: "Principal" },
    { accountId: interestAccountId, cents: interest, gstTreatment: "INPUT_TAXED", description: "Interest" },
  ];
}

/**
 * Sign off transactions and post them. Each one is validated on its own and
 * either posts or is skipped with a reason — one bad row never blocks the
 * rest, and never corrupts the batch. Every posting also records one usage
 * event, idempotent on the transaction, so a retry counts once.
 */
export async function acceptTransactions(
  firmId: string,
  userId: string,
  ids: readonly string[],
): Promise<AcceptOutcome> {
  const rows = await repo.findOwnedTransactions(firmId, ids);
  const found = new Map(rows.map((r) => [r.id, r]));
  const outcome: AcceptOutcome = { accepted: 0, skipped: [] };

  const [cashAccount, cardAccount, interestAccount] = await Promise.all([
    repo.findSystemAccountByCode(BANK_LEDGER_CODE.BANK),
    repo.findSystemAccountByCode(BANK_LEDGER_CODE.CREDIT_CARD),
    repo.findSystemAccountByCode(CODE_INTEREST_CHARGED),
  ]);

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
    const isLoanRepayment = t.loanId !== null && t.account.code === CODE_LOAN_PRINCIPAL && t.amountCents < 0;
    if (isLoanRepayment && !interestAccount) {
      outcome.skipped.push({ id, reason: "Interest account missing — run the seed" });
      continue;
    }
    const allocations: BankAllocation[] = isLoanRepayment
      ? loanAllocations(t, interestAccount!.id, accountId)
      : [{ accountId, cents: Math.abs(t.amountCents), gstTreatment, subcontractorId: t.subcontractorId }];

    const clientId = t.bankAccount.clientId;
    const written = await db.$transaction(async (tx) => {
      // Optimistic: a transaction recoded between the screen loading and the
      // click is skipped, not posted under a coding the clicker never saw.
      const claimed = await repo.updateTransactionIfVersion(tx, t.id, t.version, {
        status: "REVIEWED",
        needsReview: false,
        reviewedAt: new Date(),
        reviewedById: userId,
      });
      if (claimed === 0) return false;

      const entryId = await postBankTransactionInTx(tx, firmId, userId, {
        clientId,
        date: t.date,
        description: t.description,
        bankLedgerAccountId: bankLedger.id,
        amountCents: t.amountCents,
        gstRegistered: t.bankAccount.client.gstRegistered,
        allocations,
        bankTransactionId: t.id,
      });
      await tx.bankTransaction.update({ where: { id: t.id }, data: { journalEntryId: entryId }, select: { id: true } });
      // Metering: one reconciled transaction. The key makes a re-acceptance
      // after a reopen count once, not twice.
      await tx.usageEvent.createMany({
        data: [{ firmId, kind: "RECONCILED_TRANSACTION", quantity: 1, entityId: t.id, idempotencyKey: `accept:${t.id}` }],
        skipDuplicates: true,
      });
      await recordAudit(tx, {
        firmId,
        userId,
        clientId,
        action: "TRANSACTION_ACCEPTED",
        entityType: "BankTransaction",
        entityId: t.id,
        after: {
          journalEntryId: entryId,
          allocations: allocations.map((a) => ({ accountId: a.accountId, cents: a.cents, gstTreatment: a.gstTreatment })),
          loanId: t.loanId,
        },
      });
      return true;
    });
    if (!written) {
      outcome.skipped.push({ id, reason: "Changed by someone else — reload" });
      continue;
    }
    outcome.accepted += 1;
  }

  return outcome;
}

/**
 * Take an accepted transaction back for recoding. Its journal is reversed,
 * not deleted — the ledger keeps both entries, and the transaction keeps its
 * pointer to the entry it was posted through: the reversal is part of the
 * same row's story, and the lineage from journal to bank row must survive.
 * Acceptance later overwrites the pointer with the new entry.
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
    version: row.version,
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
  if (input.version !== undefined && input.version !== rule.version) {
    return { ok: false, error: "Someone else changed this rule while you were editing it. Reload and try again." };
  }

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

  const conflict = await db.$transaction(async (tx) => {
    const written = await repo.updateMemoryRuleIfVersion(tx, firmId, rule.id, rule.version, {
      pattern,
      matchType: input.matchType,
      accountId: account.id,
      gstTreatment: input.gstTreatment,
    });
    if (written === 0) return true;
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
    return false;
  });
  if (conflict) return { ok: false, error: "Someone else changed this rule while you were editing it. Reload and try again." };
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

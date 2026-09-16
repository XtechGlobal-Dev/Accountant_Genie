import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type { BankAccountRow } from "@/shared/contracts/bank-account";
import * as clients from "@/server/modules/clients/repository";
import * as repo from "./repository";
import type { BankAccountInput } from "./schema";

/**
 * Bank account domain operations.
 *
 * The Cash at Bank invariant lives here, not in the action and not in the
 * database: exactly one account per client carries it, because the balance
 * sheet has exactly one bank line. Every write that could break that runs
 * inside one transaction.
 */

export async function listAccounts(
  firmId: string,
  clientId: string,
): Promise<BankAccountRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;

  const accounts = await repo.listAccounts(firmId, client.id);
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    source: account.source,
    accountMask: account.accountMask,
    isCashAtBank: account.isCashAtBank,
    createdAt: account.createdAt,
    feedProductCategory: account.feedProductCategory,
    feedLastSyncedAt: account.feedLastSyncedAt,
    transactionCount: account._count.transactions,
    importCount: account._count.imports,
  }));
}

export async function countTransactionsByStatus(firmId: string, clientId: string) {
  const [transactions, awaitingReview, notCoded] = await Promise.all([
    repo.countTransactions(firmId, clientId),
    // Coded by the engine, not yet signed off by a person.
    repo.countTransactions(firmId, clientId, "CLASSIFIED"),
    // Parsed, waiting on reconciliation.
    repo.countTransactions(firmId, clientId, "PENDING"),
  ]);
  return { transactions, awaitingReview, notCoded };
}

/** `null` means the firm does not own a client with that ID. */
export async function createAccount(
  firmId: string,
  userId: string,
  clientId: string,
  input: BankAccountInput,
): Promise<{ id: string } | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;

  const existing = await repo.countAccounts(firmId, client.id);
  // The first account a client has is its Cash at Bank account by default —
  // otherwise the balance sheet would have no bank line at all.
  const cashAtBank = input.isCashAtBank || existing === 0;

  return db.$transaction(async (tx) => {
    const account = await repo.createAccount(tx, {
      clientId: client.id,
      name: input.name,
      kind: input.kind,
      source: "MANUAL",
      accountMask: input.accountMask || null,
      isCashAtBank: false,
    });

    if (cashAtBank) await repo.promoteCashAtBank(tx, client.id, account.id);
    // Which account is Cash at Bank decides the balance sheet's bank line;
    // that is an accounting fact and is audited like one.
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "BANK_ACCOUNT_CREATED",
      entityType: "BankAccount",
      entityId: account.id,
      after: { name: input.name, kind: input.kind, isCashAtBank: cashAtBank },
    });
    return account;
  });
}

/** `null` means the firm does not own a bank account with that ID. */
export async function updateAccount(
  firmId: string,
  userId: string,
  bankAccountId: string,
  input: BankAccountInput,
): Promise<{ id: string; clientId: string } | null> {
  const account = await repo.findOwnedAccount(firmId, bankAccountId);
  if (!account) return null;

  await db.$transaction(async (tx) => {
    await repo.updateAccount(tx, account.id, {
      name: input.name,
      kind: input.kind,
      accountMask: input.accountMask || null,
    });

    // Cash at Bank is only ever promoted here. The current one is demoted by
    // promoting another, so a client is never left without one.
    const promoted = input.isCashAtBank && !account.isCashAtBank;
    if (promoted) {
      await repo.promoteCashAtBank(tx, account.clientId, account.id);
    }
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: account.clientId,
      action: "BANK_ACCOUNT_UPDATED",
      entityType: "BankAccount",
      entityId: account.id,
      before: { isCashAtBank: account.isCashAtBank },
      after: { name: input.name, kind: input.kind, isCashAtBank: account.isCashAtBank || promoted },
    });
  });

  return { id: account.id, clientId: account.clientId };
}

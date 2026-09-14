import "server-only";

import type { DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * The audit row every accounting mutation writes.
 *
 * Append-only, and written through the caller's transaction client so the row
 * cannot exist without the change it describes, nor the change without the
 * row. An audit log that can diverge from what it records is worse than none,
 * because it is trusted. See .claude/skills/jobs-and-audit/SKILL.md.
 */

export type AuditAction =
  | "JOURNAL_POSTED"
  | "JOURNAL_REVERSED"
  | "ACCOUNT_CREATED"
  | "ACCOUNT_UPDATED"
  | "ACCOUNT_DEACTIVATED"
  | "ACCOUNT_REACTIVATED"
  | "PARTNERS_UPDATED"
  | "FIRM_UPDATED"
  | "PROFILE_UPDATED"
  | "STATEMENT_IMPORTED"
  | "RECONCILIATION_RUN"
  | "TRANSACTION_RECODED"
  | "TRANSACTION_ACCEPTED"
  | "TRANSACTION_REOPENED"
  | "TRANSACTION_EXCLUDED"
  | "TRANSACTION_RESTORED"
  | "MEMORY_CREATED"
  | "MEMORY_UPDATED"
  | "MEMORY_DELETED"
  | "ASSET_CREATED"
  | "ASSET_UPDATED"
  | "ASSET_DISPOSED"
  | "LOAN_CREATED"
  | "LOAN_UPDATED"
  | "LOAN_CLOSED"
  | "SUBCONTRACTOR_CREATED"
  | "SUBCONTRACTOR_UPDATED"
  | "SUBCONTRACTOR_DEACTIVATED"
  | "PLAN_CHANGED"
  | "BANK_FEED_REQUESTED"
  | "BANK_FEED_RESPONDED"
  | "USER_INVITED"
  | "USER_ROLE_CHANGED"
  | "PASSWORD_CHANGED"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "DEVICE_TRUSTED"
  | "DEVICE_REVOKED"
  | "ACCOUNT_VERIFIED"
  | "TAX_RULE_PROPOSED"
  | "TAX_RULE_VERIFIED"
  | "BANK_FEED_CONNECTED"
  | "BANK_FEED_SYNCED"
  | "BANK_FEED_REVOKED"
  | "BANK_FEED_REFRESHED"
  | "BANK_FEED_CATEGORY_SHARED";

export interface AuditEvent {
  firmId: string;
  userId: string | null;
  clientId?: string | null | undefined;
  action: AuditAction;
  entityType:
    | "JournalEntry"
    | "Account"
    | "Client"
    | "Firm"
    | "User"
    | "StatementImport"
    | "BankTransaction"
    | "MemoryRule"
    | "Asset"
    | "Loan"
    | "Subcontractor"
    | "BankFeedRequest"
    | "BankFeedConnection"
    | "TaxRuleVersion"
    | "TrustedDevice";
  entityId: string;
  before?: Prisma.InputJsonValue | undefined;
  after?: Prisma.InputJsonValue | undefined;
}

export async function recordAudit(tx: DbClient, event: AuditEvent): Promise<void> {
  await tx.auditLog.create({
    data: {
      firmId: event.firmId,
      userId: event.userId,
      clientId: event.clientId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      // Prisma distinguishes "absent" from JSON null; an absent snapshot is absent.
      ...(event.before !== undefined ? { before: event.before } : {}),
      ...(event.after !== undefined ? { after: event.after } : {}),
    },
    select: { id: true },
  });
}

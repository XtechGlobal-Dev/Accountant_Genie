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
 *
 * Answers who · what · when · why · before · after · source. "Source" is the
 * request's address and browser when there was a request; a job or a webhook
 * leaves both null, which is itself the answer.
 */

export type AuditAction =
  | "JOURNAL_POSTED"
  | "JOURNAL_REVERSED"
  | "ACCOUNT_CREATED"
  | "ACCOUNT_UPDATED"
  | "ACCOUNT_DEACTIVATED"
  | "ACCOUNT_REACTIVATED"
  | "ACCOUNT_VERIFIED"
  | "CLIENT_CREATED"
  | "CLIENT_UPDATED"
  | "CLIENT_ARCHIVED"
  | "CLIENT_RESTORED"
  | "CLIENT_NOTE_ADDED"
  | "CLIENT_LOGO_UPDATED"
  | "CLIENT_LOGO_REMOVED"
  | "PARTNERS_UPDATED"
  | "TRUST_DETAILS_UPDATED"
  | "BANK_ACCOUNT_CREATED"
  | "BANK_ACCOUNT_UPDATED"
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
  | "SUBCONTRACTOR_LINKED"
  | "BAS_GENERATED"
  | "BAS_ADJUSTED"
  | "BAS_FINALISED"
  | "PLAN_CHANGED"
  | "BANK_FEED_REQUESTED"
  | "BANK_FEED_RESPONDED"
  | "USER_INVITED"
  | "USER_ROLE_CHANGED"
  | "USER_TAX_AGENT_CHANGED"
  | "PASSWORD_CHANGED"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "DEVICE_TRUSTED"
  | "DEVICE_REVOKED"
  | "TAX_RULE_PROPOSED"
  | "TAX_RULE_VERIFIED"
  | "BANK_FEED_CONNECTED"
  | "BANK_FEED_SYNCED"
  | "BANK_FEED_REVOKED"
  | "BANK_FEED_REFRESHED"
  | "BANK_FEED_CATEGORY_SHARED"
  | "SUPPORT_REQUESTED";

export interface AuditEvent {
  firmId: string;
  userId: string | null;
  clientId?: string | null | undefined;
  action: AuditAction;
  entityType:
    | "JournalEntry"
    | "Account"
    | "AccountVerification"
    | "Client"
    | "ClientNote"
    | "Firm"
    | "User"
    | "StatementImport"
    | "BankAccount"
    | "BankTransaction"
    | "MemoryRule"
    | "Asset"
    | "Loan"
    | "Subcontractor"
    | "BasStatement"
    | "BankFeedRequest"
    | "BankFeedConnection"
    | "TaxRuleVersion"
    | "TrustedDevice";
  entityId: string;
  before?: Prisma.InputJsonValue | undefined;
  after?: Prisma.InputJsonValue | undefined;
}

/**
 * The request's address and browser, when this code is running inside one.
 *
 * Read through `next/headers`, which throws outside a request (a worker, a
 * script, a test). That case is caught and recorded as "no request" — the
 * honest answer for a job — rather than propagated into an accounting write.
 */
async function requestSource(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip = (forwarded ? forwarded.split(",")[0]?.trim() : h.get("x-real-ip")) ?? null;
    const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
    return { ip: ip ? ip.slice(0, 64) : null, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function recordAudit(tx: DbClient, event: AuditEvent): Promise<void> {
  const source = await requestSource();
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
      ip: source.ip,
      userAgent: source.userAgent,
    },
    select: { id: true },
  });
}

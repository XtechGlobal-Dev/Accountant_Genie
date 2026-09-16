import { db } from "@/server/core/db";

/**
 * Remove throwaway firms a test created, and everything under them.
 *
 * Accounting parents are `onDelete: Restrict` on purpose — a firm or client
 * delete can never take a ledger, its bank history or its audit trail with
 * it — so a test that made one has to take it apart from the leaves inward,
 * in dependency order. This is the only place that order lives.
 *
 * Never point a test at production. This deletes.
 */
export async function purgeFirms(firmIds: readonly string[]): Promise<void> {
  if (firmIds.length === 0) return;
  const ids = [...firmIds];
  const client = { client: { firmId: { in: ids } } };

  await db.$transaction(
    async (tx) => {
      await tx.usageEvent.deleteMany({ where: { firmId: { in: ids } } });
      await tx.basStatementLine.deleteMany({ where: { statement: client } });
      await tx.basStatement.deleteMany({ where: client });
      await tx.jobEvent.deleteMany({ where: { job: { firmId: { in: ids } } } });
      await tx.job.deleteMany({ where: { firmId: { in: ids } } });
      await tx.journalLine.deleteMany({ where: { entry: client } });
      await tx.journalEntry.deleteMany({ where: client });
      await tx.bankTransaction.deleteMany({ where: { bankAccount: client } });
      await tx.statementImport.deleteMany({ where: { bankAccount: client } });
      await tx.feedSyncRun.deleteMany({ where: client });
      await tx.bankFeedRequest.deleteMany({ where: client });
      await tx.bankAccount.deleteMany({ where: client });
      await tx.bankFeedConnection.deleteMany({ where: client });
      await tx.memoryRule.deleteMany({ where: { firmId: { in: ids } } });
      await tx.asset.deleteMany({ where: client });
      await tx.loan.deleteMany({ where: client });
      await tx.subcontractor.deleteMany({ where: client });
      await tx.accountVerification.deleteMany({ where: { firmId: { in: ids } } });
      await tx.account.deleteMany({ where: { firmId: { in: ids } } });
      await tx.taxRuleVersion.deleteMany({ where: { firmId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { firmId: { in: ids } } });
      await tx.partner.deleteMany({ where: client });
      await tx.beneficiary.deleteMany({ where: client });
      await tx.trustee.deleteMany({ where: client });
      await tx.clientNote.deleteMany({ where: client });
      await tx.client.deleteMany({ where: { firmId: { in: ids } } });
      await tx.trustedDevice.deleteMany({ where: { user: { firmId: { in: ids } } } });
      await tx.otpCode.deleteMany({ where: { user: { firmId: { in: ids } } } });
      await tx.session.deleteMany({ where: { user: { firmId: { in: ids } } } });
      await tx.user.deleteMany({ where: { firmId: { in: ids } } });
      await tx.firm.deleteMany({ where: { id: { in: ids } } });
    },
    { timeout: 60_000 },
  );
}

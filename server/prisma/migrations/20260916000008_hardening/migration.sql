-- Hardening from the skills audit (docs/SKILLS-AUDIT.md), 16 September 2026.
--
--   * Tax rule versions are scoped to the firm whose registered agent verifies
--     them; an account treatment sign-off is a per-firm row, never a write to
--     a shared system account.
--   * A prepared BAS is kept as three figures per label (calculated, adjustment,
--     final) and names the tax rule versions it was built under.
--   * Usage is metered as append-only, idempotent events.
--   * Optimistic locking (version) on the rows two people edit at once.
--   * Accounting parents are RESTRICT, not CASCADE: a firm or client delete can
--     never take a ledger, its bank history or its audit trail with it.
--   * Lineage: JournalLine.bankTransactionId, JournalEntry.rulesVersion,
--     AuditLog.ip/userAgent, BankTransaction.loanId.
--   * risk and the feed-sync status/trigger become enums; incomeTaxRate is
--     renamed to carry its unit.
--   * Indexes for the review screen's predicate and memory lookup.

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "FeedSyncTrigger" AS ENUM ('WEBHOOK', 'MANUAL', 'BACKFILL');

-- CreateEnum
CREATE TYPE "FeedSyncStatus" AS ENUM ('RUNNING', 'OK', 'ERROR');

-- CreateEnum
CREATE TYPE "BasStatementStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('RECONCILED_TRANSACTION');

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_firmId_fkey";

-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_clientId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_firmId_fkey";

-- DropForeignKey
ALTER TABLE "BankTransaction" DROP CONSTRAINT "BankTransaction_bankAccountId_fkey";

-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_clientId_fkey";

-- DropForeignKey
ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "Loan" DROP CONSTRAINT "Loan_clientId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryRule" DROP CONSTRAINT "MemoryRule_accountId_fkey";

-- DropForeignKey
ALTER TABLE "StatementImport" DROP CONSTRAINT "StatementImport_bankAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Subcontractor" DROP CONSTRAINT "Subcontractor_clientId_fkey";

-- DropIndex
DROP INDEX "TaxRuleVersion_code_effectiveFrom_idx";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "loanId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
-- risk was free text holding LOW/HIGH; cast in place rather than drop and re-add.
ALTER TABLE "BankTransaction" ALTER COLUMN "risk" TYPE "RiskLevel" USING ("risk"::"RiskLevel");

-- AlterTable
-- The unit belongs in the name. A rename keeps every client's rate.
ALTER TABLE "Client" RENAME COLUMN "incomeTaxRate" TO "incomeTaxRatePercent";
ALTER TABLE "Client" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FeedSyncRun" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "FeedSyncRun" ALTER COLUMN "trigger" TYPE "FeedSyncTrigger" USING ("trigger"::"FeedSyncTrigger");
ALTER TABLE "FeedSyncRun" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "FeedSyncRun" ALTER COLUMN "status" TYPE "FeedSyncStatus" USING ("status"::"FeedSyncStatus");
ALTER TABLE "FeedSyncRun" ALTER COLUMN "status" SET DEFAULT 'RUNNING';

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "rulesVersion" TEXT;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "bankTransactionId" TEXT;

-- AlterTable
ALTER TABLE "MemoryRule" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- Tax rule versions become firm-scoped. The platform-wide rows that existed
-- were seeded proposals (never verified in any deployed environment); each
-- firm is re-seeded with its own proposals by the application on sign-up and
-- by the seed. Nothing verified is lost because nothing verified existed.
DELETE FROM "TaxRuleVersion";
ALTER TABLE "TaxRuleVersion" ADD COLUMN     "firmId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "AccountVerification" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasStatement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "quarter" INTEGER,
    "month" INTEGER,
    "status" "BasStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "gstRegistered" BOOLEAN NOT NULL,
    "gstBasis" "GstBasis" NOT NULL,
    "mappingVerified" BOOLEAN NOT NULL DEFAULT false,
    "taxRuleVersions" JSONB,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
    "preparedById" TEXT,
    "finalisedById" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "calculatedCents" INTEGER NOT NULL,
    "adjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "finalCents" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "BasStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "entityId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountVerification_accountId_idx" ON "AccountVerification"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountVerification_firmId_accountId_key" ON "AccountVerification"("firmId", "accountId");

-- CreateIndex
CREATE INDEX "BasStatement_clientId_periodStart_idx" ON "BasStatement"("clientId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BasStatementLine_statementId_label_key" ON "BasStatementLine"("statementId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_firmId_createdAt_idx" ON "UsageEvent"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_status_needsReview_idx" ON "BankTransaction"("bankAccountId", "status", "needsReview");

-- CreateIndex
CREATE INDEX "BankTransaction_importId_idx" ON "BankTransaction"("importId");

-- CreateIndex
CREATE INDEX "BankTransaction_loanId_idx" ON "BankTransaction"("loanId");

-- CreateIndex
CREATE INDEX "JournalLine_bankTransactionId_idx" ON "JournalLine"("bankTransactionId");

-- CreateIndex
CREATE INDEX "MemoryRule_firmId_clientId_matchType_idx" ON "MemoryRule"("firmId", "clientId", "matchType");

-- CreateIndex
CREATE INDEX "TaxRuleVersion_firmId_code_effectiveFrom_idx" ON "TaxRuleVersion"("firmId", "code", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountVerification" ADD CONSTRAINT "AccountVerification_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountVerification" ADD CONSTRAINT "AccountVerification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountVerification" ADD CONSTRAINT "AccountVerification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRule" ADD CONSTRAINT "MemoryRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontractor" ADD CONSTRAINT "Subcontractor_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRuleVersion" ADD CONSTRAINT "TaxRuleVersion_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasStatement" ADD CONSTRAINT "BasStatement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasStatement" ADD CONSTRAINT "BasStatement_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasStatement" ADD CONSTRAINT "BasStatement_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasStatementLine" ADD CONSTRAINT "BasStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BasStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs the schema language cannot express (mirrored in prisma/sql/constraints.sql).
-- Registers: costs and loan terms are never negative.
ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_cost_nonnegative";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_cost_nonnegative" CHECK ("costCents" >= 0);

ALTER TABLE "Loan" DROP CONSTRAINT IF EXISTS "Loan_principal_nonnegative";
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_principal_nonnegative" CHECK ("principalCents" >= 0);

ALTER TABLE "Loan" DROP CONSTRAINT IF EXISTS "Loan_repayment_nonnegative";
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_repayment_nonnegative" CHECK ("repaymentCents" >= 0);

-- Prepared BAS: the final figure is always calculated + adjustment.
ALTER TABLE "BasStatementLine" DROP CONSTRAINT IF EXISTS "BasStatementLine_final_is_sum";
ALTER TABLE "BasStatementLine" ADD CONSTRAINT "BasStatementLine_final_is_sum"
  CHECK ("finalCents" = "calculatedCents" + "adjustmentCents");

-- Usage: an event always counts something.
ALTER TABLE "UsageEvent" DROP CONSTRAINT IF EXISTS "UsageEvent_quantity_positive";
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_quantity_positive" CHECK ("quantity" > 0);

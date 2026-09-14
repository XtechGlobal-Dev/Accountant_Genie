-- Database-level invariants Prisma's schema language cannot express.
--
-- Applied by `pnpm db:constraints` after `pnpm db:push` in local development,
-- and by the migration prisma/migrations/*_constraints in staging and
-- production. Idempotent: safe to run more than once.

-- Journal lines: amounts are never negative, and a line is one side only.
ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_debit_nonnegative";
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_debit_nonnegative" CHECK ("debitCents" >= 0);

ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_credit_nonnegative";
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_credit_nonnegative" CHECK ("creditCents" >= 0);

ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_one_side";
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side"
  CHECK (("debitCents" = 0) <> ("creditCents" = 0));

-- Journal entries: a posted total is never negative.
ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_total_nonnegative";
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_total_nonnegative" CHECK ("totalCents" >= 0);

-- Partners: shares are between 1 and 10 000 basis points.
ALTER TABLE "Partner" DROP CONSTRAINT IF EXISTS "Partner_share_range";
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_share_range"
  CHECK ("shareBasisPoints" BETWEEN 1 AND 10000);

-- Accounts: the @@unique([code, firmId, clientId]) index treats NULLs as
-- distinct, so two system accounts (or two firm-wide accounts) could share a
-- code. NULLS NOT DISTINCT (Postgres 15+) closes that.
DROP INDEX IF EXISTS "Account_code_firmId_clientId_key";
CREATE UNIQUE INDEX "Account_code_firmId_clientId_key"
  ON "Account" ("code", "firmId", "clientId") NULLS NOT DISTINCT;

-- Bank transactions: GST never exceeds the amount it was computed from.
ALTER TABLE "BankTransaction" DROP CONSTRAINT IF EXISTS "BankTransaction_gst_bounded";
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_gst_bounded"
  CHECK (ABS("gstCents") <= ABS("amountCents"));

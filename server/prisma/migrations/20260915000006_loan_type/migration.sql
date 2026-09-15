-- Loans gain a facility type for the register. The terms still drive the schedule.

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('EQUIPMENT_FINANCE', 'EQUIPMENT_FINANCE_LONG_TERM', 'BANK_LOAN_LONG_TERM', 'BANK_LOAN');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN "type" "LoanType" NOT NULL DEFAULT 'BANK_LOAN';

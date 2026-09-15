-- The trustee and beneficiaries of a unit or discretionary trust client.
--
-- One trustee per trust (corporate or individual, with the people who sign
-- for it) and any number of beneficiaries. Both hang off the client and go
-- with it; neither is accounting history in its own right.

-- CreateEnum
CREATE TYPE "TrusteeKind" AS ENUM ('CORPORATE', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "BeneficiaryKind" AS ENUM ('INDIVIDUAL', 'COMPANY', 'TRUST');

-- CreateTable
CREATE TABLE "Trustee" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "TrusteeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "signatories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trustee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BeneficiaryKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trustee_clientId_key" ON "Trustee"("clientId");

-- CreateIndex
CREATE INDEX "Beneficiary_clientId_idx" ON "Beneficiary"("clientId");

-- AddForeignKey
ALTER TABLE "Trustee" ADD CONSTRAINT "Trustee_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


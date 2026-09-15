-- Assets gain a category for the register, and the amount paid with its GST
-- alongside the depreciable cost. The schedule keeps using costCents.

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('COMPUTER_EQUIPMENT', 'FURNITURE_FIXTURES', 'OFFICE_EQUIPMENT', 'TOOLS_EQUIPMENT', 'MOTOR_VEHICLES', 'PLANT_EQUIPMENT', 'OTHER');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "category" "AssetCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "totalCostCents" INTEGER,
ADD COLUMN "gstCents" INTEGER;

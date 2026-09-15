import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/** The asset register. Ownership walks client → firm. */

const ROW_SELECT = {
  id: true,
  clientId: true,
  name: true,
  description: true,
  category: true,
  costCents: true,
  totalCostCents: true,
  gstCents: true,
  purchaseDate: true,
  method: true,
  effectiveLifeMonths: true,
  privateUseBasisPoints: true,
  isCar: true,
  accountId: true,
  disposedAt: true,
  disposalCents: true,
  createdAt: true,
} satisfies Prisma.AssetSelect;

export function list(firmId: string, clientId: string) {
  return db.asset.findMany({
    where: { clientId, client: { firmId } },
    orderBy: [{ disposedAt: "asc" }, { purchaseDate: "asc" }],
    select: ROW_SELECT,
  });
}

export function findOwned(firmId: string, assetId: string) {
  return db.asset.findFirst({ where: { id: assetId, client: { firmId } }, select: ROW_SELECT });
}

export function create(tx: DbClient, data: Prisma.AssetUncheckedCreateInput) {
  return tx.asset.create({ data, select: { id: true } });
}

export function update(tx: DbClient, id: string, data: Prisma.AssetUncheckedUpdateInput) {
  return tx.asset.update({ where: { id }, data, select: { id: true } });
}

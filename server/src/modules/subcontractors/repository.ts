import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/** Subcontractors belong to a client; every query walks client → firm. */

const ROW_SELECT = {
  id: true,
  name: true,
  abn: true,
  email: true,
  phone: true,
  address: true,
  isActive: true,
  createdAt: true,
  _count: { select: { lines: true } },
} satisfies Prisma.SubcontractorSelect;

export function list(firmId: string, clientId: string) {
  return db.subcontractor.findMany({
    where: { clientId, client: { firmId } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: ROW_SELECT,
  });
}

export function listOptions(firmId: string, clientId: string) {
  return db.subcontractor.findMany({
    where: { clientId, client: { firmId }, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export function findOwned(firmId: string, subcontractorId: string) {
  return db.subcontractor.findFirst({
    where: { id: subcontractorId, client: { firmId } },
    select: { ...ROW_SELECT, clientId: true },
  });
}

export function create(tx: DbClient, data: Prisma.SubcontractorUncheckedCreateInput) {
  return tx.subcontractor.create({ data, select: { id: true } });
}

export function update(tx: DbClient, id: string, data: Prisma.SubcontractorUncheckedUpdateInput) {
  return tx.subcontractor.update({ where: { id }, data, select: { id: true } });
}

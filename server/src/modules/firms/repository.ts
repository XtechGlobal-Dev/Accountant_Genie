import "server-only";

import { db, type DbClient } from "@/server/core/db";

/**
 * The firm is the tenant root, so every query here is keyed by its ID
 * directly. A user is only ever read through the firm as well — `findFirst`
 * with both IDs, so a user ID from another firm resolves to nothing.
 */

export function findFirmName(firmId: string) {
  return db.firm.findUnique({ where: { id: firmId }, select: { name: true, planCode: true } });
}

export function findFirm(firmId: string) {
  return db.firm.findUnique({
    where: { id: firmId },
    select: {
      id: true,
      name: true,
      abn: true,
      createdAt: true,
      _count: { select: { users: true, clients: true } },
    },
  });
}

export function findUser(firmId: string, userId: string) {
  return db.user.findFirst({
    where: { id: userId, firmId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isTaxAgent: true,
      agentNumber: true,
      createdAt: true,
    },
  });
}

export function updateFirm(tx: DbClient, firmId: string, data: { name: string; abn: string | null }) {
  return tx.firm.update({ where: { id: firmId }, data, select: { id: true } });
}

export async function updateUserName(
  tx: DbClient,
  firmId: string,
  userId: string,
  name: string,
): Promise<number> {
  const { count } = await tx.user.updateMany({ where: { id: userId, firmId }, data: { name } });
  return count;
}

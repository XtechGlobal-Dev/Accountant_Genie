import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/** The loan register. Ownership walks client → firm. */

const ROW_SELECT = {
  id: true,
  clientId: true,
  lender: true,
  description: true,
  principalCents: true,
  interestRateBasisPoints: true,
  startDate: true,
  termMonths: true,
  repaymentCents: true,
  frequency: true,
  status: true,
  accountId: true,
  createdAt: true,
} satisfies Prisma.LoanSelect;

export function list(firmId: string, clientId: string) {
  return db.loan.findMany({
    where: { clientId, client: { firmId } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    select: ROW_SELECT,
  });
}

export function findOwned(firmId: string, loanId: string) {
  return db.loan.findFirst({ where: { id: loanId, client: { firmId } }, select: ROW_SELECT });
}

export function create(tx: DbClient, data: Prisma.LoanUncheckedCreateInput) {
  return tx.loan.create({ data, select: { id: true } });
}

export function update(tx: DbClient, id: string, data: Prisma.LoanUncheckedUpdateInput) {
  return tx.loan.update({ where: { id }, data, select: { id: true } });
}

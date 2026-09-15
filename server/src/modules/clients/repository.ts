import "server-only";

import { db, type DbClient } from "@/server/core/db";
import type { Prisma } from "@/generated/prisma";

/**
 * Every query in this file takes `firmId` and puts it inside the `where`.
 *
 * Ownership is part of the query, never a check afterwards: `findFirst` with
 * the ownership path returns nothing for another firm's ID, and `updateMany`
 * writes nothing. Neither can be bypassed by forgetting a guard, because there
 * is no guard to forget.
 *
 * See .claude/skills/tenant-security/SKILL.md.
 */

/** Selected once so the list, the header and the details page cannot drift. */
const LIST_SELECT = {
  id: true,
  businessName: true,
  abn: true,
  email: true,
  phone: true,
  industry: true,
  entityType: true,
  gstRegistered: true,
  basFrequency: true,
  archivedAt: true,
  _count: { select: { bankAccounts: true } },
} satisfies Prisma.ClientSelect;

const HEADER_SELECT = {
  id: true,
  businessName: true,
  legalName: true,
  abn: true,
  entityType: true,
  gstRegistered: true,
  gstBasis: true,
  basFrequency: true,
  archivedAt: true,
  logoKey: true,
} satisfies Prisma.ClientSelect;

const DETAIL_SELECT = {
  ...HEADER_SELECT,
  industry: true,
  email: true,
  phone: true,
  incomeTaxRate: true,
  totalUnits: true,
  unitValueCents: true,
  createdAt: true,
} satisfies Prisma.ClientSelect;

export function listClients(firmId: string, archived: boolean) {
  return db.client.findMany({
    where: { firmId, archivedAt: archived ? { not: null } : null },
    orderBy: { businessName: "asc" },
    select: LIST_SELECT,
  });
}

export function listClientOptions(firmId: string) {
  return db.client.findMany({
    where: { firmId, archivedAt: null },
    orderBy: { businessName: "asc" },
    select: { id: true, businessName: true },
  });
}

export function findClientHeader(firmId: string, clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, firmId },
    select: HEADER_SELECT,
  });
}

export function findClientDetail(firmId: string, clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, firmId },
    select: DETAIL_SELECT,
  });
}

export function findClientLogoKey(firmId: string, clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, firmId },
    select: { logoKey: true },
  });
}

/** Existence-and-ownership probe, for writes that need the parent resolved first. */
export function findOwnedClientId(firmId: string, clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true },
  });
}

export function createClient(data: Prisma.ClientUncheckedCreateInput) {
  return db.client.create({ data, select: { id: true } });
}

/**
 * `updateMany` rather than `update`: the firm goes in the `where`, so a client
 * belonging to another firm matches nothing and reports zero rows written.
 * Returns the number of rows affected — 0 means "not found", never "forbidden".
 */
export async function updateOwnedClient(
  firmId: string,
  clientId: string,
  data: Prisma.ClientUncheckedUpdateInput,
): Promise<number> {
  const { count } = await db.client.updateMany({
    where: { id: clientId, firmId },
    data,
  });
  return count;
}

export function listClientNotes(firmId: string, clientId: string) {
  return db.clientNote.findMany({
    where: { clientId, client: { firmId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true, createdAt: true },
  });
}

export function createClientNote(clientId: string, title: string, body: string) {
  return db.clientNote.create({
    data: { clientId, title, body },
    select: { id: true },
  });
}

export function countClients(firmId: string, archived: boolean) {
  return db.client.count({
    where: { firmId, archivedAt: archived ? { not: null } : null },
  });
}

/* -------------------------------------------------------------------------- */
/* Partners                                                                   */
/* -------------------------------------------------------------------------- */

export function listPartners(firmId: string, clientId: string) {
  return db.partner.findMany({
    where: { clientId, client: { firmId } },
    orderBy: [{ shareBasisPoints: "desc" }, { name: "asc" }],
    select: { id: true, name: true, shareBasisPoints: true },
  });
}

/**
 * The partner set is replaced whole: the rule that shares sum to 100% is a
 * property of the set, not of any one row, so rows are never edited alone.
 * Runs on the caller's transaction so the audit row lands with the change.
 */
export async function replacePartners(
  tx: DbClient,
  clientId: string,
  partners: ReadonlyArray<{ name: string; shareBasisPoints: number }>,
) {
  await tx.partner.deleteMany({ where: { clientId } });
  await tx.partner.createMany({
    data: partners.map((partner) => ({ clientId, ...partner })),
  });
}

/* -------------------------------------------------------------------------- */
/* Trust details                                                              */
/* -------------------------------------------------------------------------- */

export async function findTrustDetails(firmId: string, clientId: string) {
  const [trustee, beneficiaries] = await Promise.all([
    db.trustee.findFirst({
      where: { clientId, client: { firmId } },
      select: { id: true, kind: true, name: true, abn: true, signatories: true },
    }),
    db.beneficiary.findMany({
      where: { clientId, client: { firmId } },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
  ]);
  return { trustee, beneficiaries };
}

/**
 * The trustee and the beneficiaries are replaced together: they describe one
 * deed, and a half-updated pair would be read later as meaning something.
 * Runs on the caller's transaction so the audit row lands with the change.
 */
export async function replaceTrustDetails(
  tx: DbClient,
  clientId: string,
  input: {
    trustee: { kind: "CORPORATE" | "INDIVIDUAL"; name: string; abn: string | null; signatories: string[] };
    beneficiaries: ReadonlyArray<{ name: string; kind: "INDIVIDUAL" | "COMPANY" | "TRUST" }>;
  },
) {
  await tx.trustee.upsert({
    where: { clientId },
    create: { clientId, ...input.trustee },
    update: input.trustee,
  });
  await tx.beneficiary.deleteMany({ where: { clientId } });
  await tx.beneficiary.createMany({
    data: input.beneficiaries.map((beneficiary) => ({ clientId, ...beneficiary })),
  });
}

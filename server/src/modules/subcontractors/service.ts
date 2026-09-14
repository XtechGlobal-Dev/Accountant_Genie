import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import * as clients from "@/server/modules/clients/repository";
import type { ActionResult } from "@/shared/contracts/result";
import type { SubcontractorRow } from "@/shared/contracts/register";
import * as repo from "./repository";
import type { SubcontractorInput } from "./schema";

/**
 * The subcontractor register — the prerequisite for a TPAR. A client with no
 * subcontractors recorded has no TPAR to generate.
 */

type Row = Awaited<ReturnType<typeof repo.list>>[number];

function toRow(row: Row): SubcontractorRow {
  return {
    id: row.id,
    name: row.name,
    abn: row.abn,
    email: row.email,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    paymentCount: row._count.lines,
    createdAt: row.createdAt,
  };
}

const orNull = (v: string | undefined) => v || null;

export async function listSubcontractors(firmId: string, clientId: string): Promise<SubcontractorRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return (await repo.list(firmId, client.id)).map(toRow);
}

export async function listSubcontractorOptions(
  firmId: string,
  clientId: string,
): Promise<{ id: string; name: string }[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  return repo.listOptions(firmId, client.id);
}

export async function createSubcontractor(
  firmId: string,
  userId: string,
  clientId: string,
  input: SubcontractorInput,
): Promise<ActionResult> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };

  const id = await db.$transaction(async (tx) => {
    const created = await repo.create(tx, {
      clientId: client.id,
      name: input.name,
      abn: orNull(input.abn),
      email: orNull(input.email),
      phone: orNull(input.phone),
      address: orNull(input.address),
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "SUBCONTRACTOR_CREATED",
      entityType: "Subcontractor",
      entityId: created.id,
      after: { name: input.name, abn: orNull(input.abn) },
    });
    return created.id;
  });
  return { ok: true, id };
}

export async function updateSubcontractor(
  firmId: string,
  userId: string,
  subcontractorId: string,
  input: SubcontractorInput,
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, subcontractorId);
  if (!existing) return { ok: false, error: "Subcontractor not found" };

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, {
      name: input.name,
      abn: orNull(input.abn),
      email: orNull(input.email),
      phone: orNull(input.phone),
      address: orNull(input.address),
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "SUBCONTRACTOR_UPDATED",
      entityType: "Subcontractor",
      entityId: existing.id,
      before: { name: existing.name, abn: existing.abn },
      after: { name: input.name, abn: orNull(input.abn) },
    });
  });
  return { ok: true, id: existing.id };
}

/** Deactivated, never deleted: a TPAR for a past year still names them. */
export async function setSubcontractorActive(
  firmId: string,
  userId: string,
  subcontractorId: string,
  active: boolean,
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, subcontractorId);
  if (!existing) return { ok: false, error: "Subcontractor not found" };
  if (existing.isActive === active) return { ok: true, id: existing.id };

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, { isActive: active });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "SUBCONTRACTOR_DEACTIVATED",
      entityType: "Subcontractor",
      entityId: existing.id,
      before: { isActive: existing.isActive },
      after: { isActive: active },
    });
  });
  return { ok: true, id: existing.id };
}

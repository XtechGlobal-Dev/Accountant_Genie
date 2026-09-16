import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getAIProvider } from "@/server/ai";
import { CODE_SUBCONTRACTORS } from "@/server/au/coa";
import * as clients from "@/server/modules/clients/repository";
import { currentRule, parseCodes } from "@/server/modules/tax-rules/service";
import type { ActionResult } from "@/shared/contracts/result";
import type { SubcontractorProposals, SubcontractorRow } from "@/shared/contracts/register";
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

/* -------------------------------------------------------------------------- */
/* AI identification — proposes, a person confirms                            */
/* -------------------------------------------------------------------------- */

/**
 * Payments on the TPAR-reportable accounts that no subcontractor is linked
 * to, with the model's proposal for each: a register entry it matches, a name
 * to add, or nothing. Nothing is written here. The person confirms a link
 * through the ordinary recode — with the same ownership checks — or adds the
 * subcontractor first. The proposals carry lineage like any AI decision.
 */
export async function proposeSubcontractorLinks(
  firmId: string,
  clientId: string,
): Promise<SubcontractorProposals | null> {
  const client = await clients.findClientDetail(firmId, clientId);
  if (!client) return null;

  const rule = await currentRule(firmId, "TPAR_ACCOUNTS", new Date());
  const codes = parseCodes(rule?.valueText, [CODE_SUBCONTRACTORS]);
  const [unlinked, register] = await Promise.all([
    db.bankTransaction.findMany({
      where: {
        bankAccount: { clientId: client.id, client: { firmId } },
        excludedAt: null,
        status: { in: ["PENDING", "CLASSIFIED"] },
        subcontractorId: null,
        account: { code: { in: codes } },
      },
      orderBy: { date: "desc" },
      take: 100,
      select: { id: true, date: true, description: true, amountCents: true },
    }),
    repo.list(firmId, client.id),
  ]);
  if (unlinked.length === 0) {
    return { proposals: [], provider: null, promptVersion: null, failure: null };
  }

  const response = await getAIProvider().identifySubcontractors({
    transactions: unlinked.map((t) => ({ ref: t.id, description: t.description, amountCents: t.amountCents, date: t.date.toISOString().slice(0, 10) })),
    known: register.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, abn: s.abn })),
    client: { industry: client.industry },
  });

  const byId = new Map(register.map((s) => [s.id, s]));
  const byRef = new Map(response.results.map((r) => [r.ref, r]));
  return {
    provider: response.meta.provider,
    promptVersion: response.meta.promptVersion,
    failure: response.failure ? `${response.failure.kind}: ${response.failure.detail}` : null,
    proposals: unlinked.map((t) => {
      const result = byRef.get(t.id);
      // The gate: a known id must be on THIS client's register or it is nothing.
      const known = result?.knownId ? byId.get(result.knownId) : undefined;
      return {
        transactionId: t.id,
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
        knownId: known?.id ?? null,
        knownName: known?.name ?? null,
        proposedName: known ? null : (result?.proposedName ?? null),
        confidence: result?.confidence ?? 0,
        reason: result?.reason ?? "No proposal",
      };
    }),
  };
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

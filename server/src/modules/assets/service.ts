import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import * as accounts from "@/server/modules/accounts/repository";
import * as clients from "@/server/modules/clients/repository";
import type { ActionResult } from "@/shared/contracts/result";
import type { AssetRow, DepreciationSchedule } from "@/shared/contracts/register";
import { currentRule, parseDepreciationMethods } from "@/server/modules/tax-rules/service";
import { STATUTORY_DEPRECIATION_RATES } from "@/server/modules/tax-rules/catalogue";
import { financialYearRange } from "@/server/au/fy";
import { depreciationSchedule, type VerifiedThresholds } from "./depreciation";
import * as repo from "./repository";
import type { AssetInput, DisposeAssetInput } from "./schema";

/**
 * The asset register — the prerequisite for a depreciation schedule.
 * Depreciation is never stored; the schedule computes it from these facts.
 */

type Row = Awaited<ReturnType<typeof repo.list>>[number];

async function accountNames(firmId: string, rows: readonly Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.accountId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const found = await accounts.resolveForFirm(firmId, ids);
  return new Map(found.map((a) => [a.id, `${a.code} · ${a.name}`]));
}

function toRow(row: Row, names: Map<string, string>): AssetRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    costCents: row.costCents,
    totalCostCents: row.totalCostCents,
    gstCents: row.gstCents,
    purchaseDate: row.purchaseDate,
    method: row.method,
    effectiveLifeMonths: row.effectiveLifeMonths,
    privateUseBasisPoints: row.privateUseBasisPoints,
    isCar: row.isCar,
    accountId: row.accountId,
    accountName: row.accountId ? (names.get(row.accountId) ?? null) : null,
    disposedAt: row.disposedAt,
    disposalCents: row.disposalCents,
    createdAt: row.createdAt,
  };
}

export async function listAssets(firmId: string, clientId: string): Promise<AssetRow[] | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const rows = await repo.list(firmId, client.id);
  const names = await accountNames(firmId, rows);
  return rows.map((row) => toRow(row, names));
}

export interface ThresholdVerification {
  writeOff: boolean;
  carLimit: boolean;
  /** Whether the method rates come from a verified rule or the statutory fallback. */
  methods: boolean;
}

/**
 * Thresholds verified for the year by THIS firm's advisor — absent when they
 * have not signed them off. The method rates are the one figure the schedule
 * cannot do without: with no verified version it uses the statutory rates
 * and the report says so, rather than showing no depreciation at all.
 */
export async function verifiedThresholds(
  firmId: string,
  fy: number,
): Promise<VerifiedThresholds & { verified: ThresholdVerification; ruleVersions: Record<string, string | null> }> {
  const asAt = new Date(financialYearRange(fy).end.getTime() - 1);
  const [writeOff, carLimit, methods] = await Promise.all([
    currentRule(firmId, "INSTANT_ASSET_WRITE_OFF", asAt),
    currentRule(firmId, "CAR_LIMIT", asAt),
    currentRule(firmId, "DEPRECIATION_METHODS", asAt),
  ]);
  const rates = parseDepreciationMethods(methods?.valueText);
  return {
    instantWriteOffCents: writeOff?.valueCents ?? null,
    carLimitCents: carLimit?.valueCents ?? null,
    rates: rates ?? STATUTORY_DEPRECIATION_RATES,
    verified: { writeOff: writeOff !== null, carLimit: carLimit !== null, methods: rates !== null },
    ruleVersions: {
      INSTANT_ASSET_WRITE_OFF: writeOff?.id ?? null,
      CAR_LIMIT: carLimit?.id ?? null,
      DEPRECIATION_METHODS: methods?.id ?? null,
    },
  };
}

export async function getDepreciationSchedule(
  firmId: string,
  clientId: string,
  fy: number,
): Promise<DepreciationSchedule | null> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return null;
  const [rows, thresholds] = await Promise.all([repo.list(firmId, client.id), verifiedThresholds(firmId, fy)]);
  return {
    ...depreciationSchedule(rows, fy, thresholds),
    thresholds: { writeOffCents: thresholds.instantWriteOffCents ?? null, carLimitCents: thresholds.carLimitCents ?? null },
    methodsVerified: thresholds.verified.methods,
    ruleVersions: thresholds.ruleVersions,
  };
}

async function resolveAccount(
  firmId: string,
  clientId: string,
  accountId: string | undefined,
): Promise<{ accountId: string | null } | { error: ActionResult }> {
  if (!accountId) return { accountId: null };
  const [account] = await accounts.resolveForClient(firmId, clientId, [accountId]);
  if (!account || account.type !== "ASSET") {
    return { error: { ok: false, error: "Choose an asset account", field: "accountId" } };
  }
  return { accountId: account.id };
}

export async function createAsset(
  firmId: string,
  userId: string,
  clientId: string,
  input: AssetInput,
): Promise<ActionResult> {
  const client = await clients.findOwnedClientId(firmId, clientId);
  if (!client) return { ok: false, error: "Client not found" };
  const scope = await resolveAccount(firmId, client.id, input.accountId);
  if ("error" in scope) return scope.error;

  const id = await db.$transaction(async (tx) => {
    const created = await repo.create(tx, {
      clientId: client.id,
      name: input.name,
      description: input.description || null,
      category: input.category,
      costCents: input.costCents,
      totalCostCents: input.totalCostCents,
      gstCents: input.gstCents,
      purchaseDate: input.purchaseDate,
      method: input.method,
      effectiveLifeMonths: input.effectiveLifeMonths,
      privateUseBasisPoints: input.privateUseBasisPoints,
      isCar: input.isCar,
      accountId: scope.accountId,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: client.id,
      action: "ASSET_CREATED",
      entityType: "Asset",
      entityId: created.id,
      after: { name: input.name, costCents: input.costCents, method: input.method, effectiveLifeMonths: input.effectiveLifeMonths },
    });
    return created.id;
  });
  return { ok: true, id };
}

export async function updateAsset(
  firmId: string,
  userId: string,
  assetId: string,
  input: AssetInput,
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, assetId);
  if (!existing) return { ok: false, error: "Asset not found" };
  const scope = await resolveAccount(firmId, existing.clientId, input.accountId);
  if ("error" in scope) return scope.error;

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, {
      name: input.name,
      description: input.description || null,
      category: input.category,
      costCents: input.costCents,
      totalCostCents: input.totalCostCents,
      gstCents: input.gstCents,
      purchaseDate: input.purchaseDate,
      method: input.method,
      effectiveLifeMonths: input.effectiveLifeMonths,
      privateUseBasisPoints: input.privateUseBasisPoints,
      isCar: input.isCar,
      accountId: scope.accountId,
    });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "ASSET_UPDATED",
      entityType: "Asset",
      entityId: existing.id,
      before: { name: existing.name, costCents: existing.costCents, method: existing.method, effectiveLifeMonths: existing.effectiveLifeMonths, privateUseBasisPoints: existing.privateUseBasisPoints },
      after: { name: input.name, costCents: input.costCents, method: input.method, effectiveLifeMonths: input.effectiveLifeMonths, privateUseBasisPoints: input.privateUseBasisPoints },
    });
  });
  return { ok: true, id: existing.id };
}

/** An asset is disposed, never deleted: past schedules still show it. */
export async function disposeAsset(
  firmId: string,
  userId: string,
  assetId: string,
  input: DisposeAssetInput,
): Promise<ActionResult> {
  const existing = await repo.findOwned(firmId, assetId);
  if (!existing) return { ok: false, error: "Asset not found" };
  if (existing.disposedAt) return { ok: false, error: "This asset has already been disposed" };
  if (input.disposedAt < existing.purchaseDate) {
    return { ok: false, error: "Disposal cannot be before the purchase date", field: "disposedAt" };
  }

  await db.$transaction(async (tx) => {
    await repo.update(tx, existing.id, { disposedAt: input.disposedAt, disposalCents: input.disposalCents });
    await recordAudit(tx, {
      firmId,
      userId,
      clientId: existing.clientId,
      action: "ASSET_DISPOSED",
      entityType: "Asset",
      entityId: existing.id,
      after: { disposedAt: input.disposedAt.toISOString(), disposalCents: input.disposalCents },
    });
  });
  return { ok: true, id: existing.id };
}

import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import type { ActionResult } from "@/shared/contracts/result";
import type { TaxRuleVersionView, TaxRuleView } from "@/shared/contracts/tax-rule";
import { TAX_RULES, ruleDefinition } from "./catalogue";

/**
 * Versioned tax rules with advisor sign-off.
 *
 * A version is proposed (pending), then verified by a registered tax agent,
 * which supersedes any earlier verified version of the same rule whose
 * effective window overlaps. Reports read `currentRule(code, asAt)`, which
 * returns only a VERIFIED version in effect on that date — a pending value
 * is never applied. Historical reports keep reproducing because versions are
 * never edited, only added.
 */

type Row = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  valueCents: number | null;
  valueText: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "SUPERSEDED";
  note: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  verifiedBy: { name: string } | null;
};

const SELECT = {
  id: true,
  code: true,
  label: true,
  description: true,
  valueCents: true,
  valueText: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  note: true,
  verifiedAt: true,
  createdAt: true,
  verifiedBy: { select: { name: true } },
} as const;

function toView(row: Row): TaxRuleVersionView {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description,
    valueCents: row.valueCents,
    valueText: row.valueText,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    note: row.note,
    verifiedBy: row.verifiedBy?.name ?? null,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  };
}

/** The verified version in effect on a date, or null when none is. */
export async function currentRule(code: string, asAt: Date): Promise<TaxRuleVersionView | null> {
  const row = await db.taxRuleVersion.findFirst({
    where: {
      code,
      status: "VERIFIED",
      effectiveFrom: { lte: asAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asAt } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: SELECT,
  });
  return row ? toView(row) : null;
}

/** Whether a mapping rule has been verified at all — for report badges. */
export async function ruleVerified(code: string, asAt: Date): Promise<boolean> {
  return (await currentRule(code, asAt)) !== null;
}

export async function listTaxRules(): Promise<TaxRuleView[]> {
  const rows = await db.taxRuleVersion.findMany({
    orderBy: [{ code: "asc" }, { effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: SELECT,
  });
  const now = new Date();
  return TAX_RULES.map((definition) => {
    const versions = rows.filter((row) => row.code === definition.code).map(toView);
    const current =
      versions.find(
        (v) =>
          v.status === "VERIFIED" && v.effectiveFrom <= now && (v.effectiveTo === null || v.effectiveTo > now),
      ) ?? null;
    return {
      code: definition.code,
      label: definition.label,
      description: definition.description,
      current,
      versions,
      kind: definition.kind,
    };
  });
}

export interface RuleInput {
  code: string;
  valueCents: number | null;
  valueText: string | null;
  effectiveFrom: Date;
  note: string | null;
}

/** A new pending version. Anyone who can manage the organisation may propose; only an agent verifies. */
export async function proposeVersion(firmId: string, userId: string, input: RuleInput): Promise<ActionResult> {
  const definition = ruleDefinition(input.code);
  if (!definition) return { ok: false, error: "Unknown rule" };
  if (definition.kind === "AMOUNT" && input.valueCents === null) {
    return { ok: false, error: "Enter the amount", field: "value" };
  }
  if (definition.kind === "TEXT" && !input.valueText) {
    return { ok: false, error: "Enter the value", field: "value" };
  }

  const id = await db.$transaction(async (tx) => {
    const created = await tx.taxRuleVersion.create({
      data: {
        code: definition.code,
        label: definition.label,
        description: definition.description,
        valueCents: definition.kind === "AMOUNT" ? input.valueCents : null,
        valueText: definition.kind === "TEXT" ? input.valueText : null,
        effectiveFrom: input.effectiveFrom,
        note: input.note,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "TAX_RULE_PROPOSED",
      entityType: "TaxRuleVersion",
      entityId: created.id,
      after: { code: definition.code, valueCents: input.valueCents, valueText: input.valueText, effectiveFrom: input.effectiveFrom.toISOString() },
    });
    return created.id;
  });
  return { ok: true, id };
}

/**
 * Sign a pending version off. The caller must be a registered tax agent —
 * the action checks that; the service records who. Earlier verified versions
 * of the same rule that overlap are superseded, never edited.
 */
export async function verifyVersion(
  firmId: string,
  userId: string,
  versionId: string,
  note: string | null,
): Promise<ActionResult> {
  const version = await db.taxRuleVersion.findUnique({ where: { id: versionId }, select: SELECT });
  if (!version) return { ok: false, error: "Version not found" };
  if (version.status !== "PENDING_VERIFICATION") return { ok: false, error: "Only a pending version can be verified" };
  if (version.valueCents === null && !version.valueText) {
    return { ok: false, error: "A version without a value cannot be verified" };
  }

  await db.$transaction(async (tx) => {
    await tx.taxRuleVersion.updateMany({
      where: {
        code: version.code,
        status: "VERIFIED",
        id: { not: version.id },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: version.effectiveFrom } }],
      },
      data: { status: "SUPERSEDED", effectiveTo: version.effectiveFrom },
    });
    await tx.taxRuleVersion.update({
      where: { id: version.id },
      data: { status: "VERIFIED", verifiedById: userId, verifiedAt: new Date(), note: note ?? version.note },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "TAX_RULE_VERIFIED",
      entityType: "TaxRuleVersion",
      entityId: version.id,
      after: { code: version.code, valueCents: version.valueCents, valueText: version.valueText, effectiveFrom: version.effectiveFrom.toISOString() },
    });
  });
  return { ok: true, id: version.id };
}

/** Account codes from a verified mapping rule, or the fallback when none is verified. */
export function parseCodes(valueText: string | null | undefined, fallback: readonly number[]): number[] {
  if (!valueText) return [...fallback];
  const codes = valueText
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0);
  return codes.length > 0 ? codes : [...fallback];
}

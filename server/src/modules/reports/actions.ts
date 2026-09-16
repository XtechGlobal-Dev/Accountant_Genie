"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/core/session";
import { can, forbidden } from "@/server/core/permissions";
import { invalid } from "@/server/core/result";
import { parseCents } from "@/shared/money";
import type { ActionResult } from "@/shared/contracts/result";
import { resolvePeriod } from "./period";
import * as service from "./service";

/**
 * The transport edge of prepared BAS statements. Preparing and adjusting need
 * `bas:prepare`; finalising — the sign-off a tax agent hands on — needs
 * `bas:approve`. Every action re-scopes the client from the session.
 */

const PeriodQuerySchema = z.object({
  fy: z.string().optional(),
  q: z.string().optional(),
  m: z.string().optional(),
});

export async function prepareBas(clientId: string, query: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "bas:prepare")) return forbidden();
  const parsed = PeriodQuerySchema.safeParse(query ?? {});
  if (!parsed.success) return invalid(parsed.error);
  const period = resolvePeriod(parsed.data);
  const result = await service.prepareBasStatement(session.firmId, session.userId, clientId, period);
  if (result.ok) revalidatePath(`/clients/${clientId}/reports/bas`, "layout");
  return result;
}

const AdjustSchema = z.object({
  label: z.string().trim().min(1).max(4),
  /** Dollars and cents as typed; may be negative. */
  adjustment: z.string().trim().max(20),
  note: z.string().trim().max(300).optional(),
  version: z.coerce.number().int().min(0),
});

export async function adjustBasLine(clientId: string, statementId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "bas:prepare")) return forbidden();
  const parsed = AdjustSchema.safeParse({
    label: formData.get("label"),
    adjustment: formData.get("adjustment") ?? "0",
    note: formData.get("note") ?? "",
    version: formData.get("version"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const raw = parsed.data.adjustment.replace(/^\+/, "");
  const negative = raw.startsWith("-");
  const magnitude = parseCents(negative ? raw.slice(1) : raw);
  if (magnitude === null) return { ok: false, error: "Enter the adjustment in dollars and cents", field: "adjustment" };
  const result = await service.adjustBasLine(session.firmId, session.userId, clientId, statementId, {
    label: parsed.data.label,
    adjustmentCents: negative ? -magnitude : magnitude,
    note: parsed.data.note || null,
    version: parsed.data.version,
  });
  if (result.ok) revalidatePath(`/clients/${clientId}/reports/bas`, "layout");
  return result;
}

export async function finaliseBas(clientId: string, statementId: string, version: number): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "bas:approve")) return forbidden();
  const parsedVersion = z.coerce.number().int().min(0).safeParse(version);
  if (!parsedVersion.success) return { ok: false, error: "Reload and try again" };
  const result = await service.finaliseBasStatement(session.firmId, session.userId, clientId, statementId, parsedVersion.data);
  if (result.ok) revalidatePath(`/clients/${clientId}/reports/bas`, "layout");
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { invalid } from "@/server/core/result";
import { can, forbidden } from "@/server/core/permissions";
import type { ActionResult } from "@/shared/contracts/result";
import { fromForm } from "./schema";
import * as service from "./service";

/**
 * The transport edge of authentication. Public actions take a form and either
 * redirect to the next step or return a form-shaped error. Nothing here
 * throws a password or a code back to the browser.
 */

export type AuthFormResult = { ok: false; error: string; field?: string } | { ok: true; note: string | null };

/** The caller's address, for throttling. Behind a proxy the first forwarded hop is the client. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : (h.get("x-real-ip") ?? null);
}

function fail(result: { ok: false; error: string; field?: string }): AuthFormResult {
  return result.field ? { ok: false, error: result.error, field: result.field } : { ok: false, error: result.error };
}

export async function signIn(formData: FormData): Promise<AuthFormResult> {
  const parsed = fromForm.signIn(formData);
  if (!parsed.success) return invalid(parsed.error) as AuthFormResult;
  const result = await service.signIn(parsed.data.email, parsed.data.password, await clientIp());
  if (!result.ok) return fail(result);
  redirect(result.next + (result.note ? "?console=1" : ""));
}

export async function signUp(formData: FormData): Promise<AuthFormResult> {
  const parsed = fromForm.signUp(formData);
  if (!parsed.success) return invalid(parsed.error) as AuthFormResult;
  const result = await service.signUp(parsed.data);
  if (!result.ok) return fail(result);
  redirect(result.next + (result.note ? "?console=1" : ""));
}

export async function verifyCode(formData: FormData): Promise<AuthFormResult> {
  const parsed = fromForm.otp(formData);
  if (!parsed.success) return invalid(parsed.error) as AuthFormResult;
  const result = await service.verifySignIn(parsed.data.code);
  if (!result.ok) return fail(result);
  redirect(result.next);
}

export async function resendCode(): Promise<AuthFormResult> {
  const result = await service.resendCode(await clientIp());
  if (!result.ok) return fail(result);
  return { ok: true, note: result.note };
}

export async function requestPasswordReset(formData: FormData): Promise<AuthFormResult> {
  const parsed = fromForm.forgot(formData);
  if (!parsed.success) return invalid(parsed.error) as AuthFormResult;
  const result = await service.requestPasswordReset(parsed.data.email, await clientIp());
  if (!result.ok) return fail(result);
  redirect(result.next + (result.note ? "?console=1" : ""));
}

export async function resetPassword(formData: FormData): Promise<AuthFormResult> {
  const parsed = fromForm.reset(formData);
  if (!parsed.success) return invalid(parsed.error) as AuthFormResult;
  const result = await service.resetPassword(parsed.data.code, parsed.data.password);
  if (!result.ok) return fail(result);
  redirect(result.next);
}

export async function signOut(): Promise<void> {
  const session = await requireSession();
  await service.signOut(session.firmId, session.userId);
  redirect("/sign-in");
}

/* -------------------------------------------------------------------------- */
/* Signed-in                                                                  */
/* -------------------------------------------------------------------------- */

export async function changePassword(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fromForm.changePassword(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.changePassword(session.firmId, session.userId, parsed.data.current, parsed.data.password);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function inviteUser(formData: FormData): Promise<service.InviteResult> {
  const session = await requireSession();
  if (!can(session, "users:manage")) return forbidden() as service.InviteResult;
  const parsed = fromForm.invite(formData);
  if (!parsed.success) return invalid(parsed.error) as service.InviteResult;
  const result = await service.inviteUser(session.firmId, session.userId, parsed.data);
  if (result.ok) revalidatePath("/settings/team");
  return result;
}

export async function changeRole(userId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!can(session, "users:manage")) return forbidden();
  const parsed = fromForm.role(formData);
  if (!parsed.success) return invalid(parsed.error);
  const result = await service.changeRole(session.firmId, session.userId, userId, parsed.data.role);
  if (result.ok) revalidatePath("/settings/team");
  return result;
}

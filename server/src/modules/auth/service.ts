import "server-only";

import { createHash, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { db, type DbClient } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getMailer, mailIsConsoleOnly } from "@/server/core/mail";
import { hashPassword, temporaryPassword, verifyPassword } from "@/server/core/password";
import { createSession, destroyAllSessions, destroySession } from "@/server/core/session";
import {
  clearDeviceCookie,
  currentDeviceHash,
  deviceIsTrusted,
  mintDeviceToken,
  setDeviceCookie,
} from "@/server/core/trusted-device";
import { consume, minutesLeft, reset } from "@/server/core/rate-limit";
import type { ActionResult } from "@/shared/contracts/result";
import type { TeamMember, TrustedDeviceRow } from "@/shared/contracts/settings";
import type { OtpPurpose, UserRole } from "@/generated/prisma";
import type { AuState, ProfessionalBody } from "@/generated/prisma";

/**
 * Sign-in, sign-up, one-time codes, password reset and the team.
 *
 * Sign-in is two steps: password, then a six-digit code sent by email. The
 * code is hashed at rest with a server secret, expires in ten minutes, is
 * single use and locks after five wrong attempts. The step between the two
 * is carried by a short-lived cookie naming the code row — the row ID alone
 * is worthless without the code.
 *
 * Failures are described the same way whether the email exists or not, so
 * the sign-in form cannot be used to enumerate accounts.
 */

const PENDING_COOKIE = "ledgerly_pending";
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function secret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not set");
  }
  return "dev-only-insecure-secret";
}

const hashCode = (code: string) => createHash("sha256").update(`${secret()}:${code}`).digest("hex");

const GENERIC_SIGN_IN_ERROR = "That email and password do not match";

/** Throttle keys never hold the address in the clear. */
const keyFor = (kind: string, value: string) =>
  `${kind}:${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32)}`;
const WINDOW_MS = 15 * 60_000;

/**
 * Too many failures from one email or one address and sign-in pauses for
 * the rest of the window. The message says how long, never which limit hit.
 */
async function throttled(kind: string, subject: string, ip: string | null): Promise<string | null> {
  const bySubject = await consume(keyFor(`${kind}:subject`, subject), 5, WINDOW_MS);
  const byIp = ip ? await consume(keyFor(`${kind}:ip`, ip), 30, WINDOW_MS) : { ok: true, retryAfterMs: 0 };
  if (bySubject.ok && byIp.ok) return null;
  const minutes = minutesLeft(Math.max(bySubject.retryAfterMs, byIp.retryAfterMs));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/* -------------------------------------------------------------------------- */
/* One-time codes                                                             */
/* -------------------------------------------------------------------------- */

async function issueCode(userId: string, email: string, purpose: OtpPurpose): Promise<string> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const row = await db.otpCode.create({
    data: {
      userId,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
    },
    select: { id: true },
  });

  const subject =
    purpose === "PASSWORD_RESET" ? "Your Accountant Genie password reset code" : "Your Accountant Genie sign-in code";
  await getMailer().send({
    to: email,
    subject,
    text: `Your code is ${code}. It expires in ${OTP_MINUTES} minutes.\n\nIf you did not request this, ignore this message.`,
  });

  return row.id;
}

async function setPending(otpId: string): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, otpId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OTP_MINUTES * 60,
  });
}

async function readPending(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PENDING_COOKIE)?.value ?? null;
}

async function clearPending(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
}

/**
 * Check a code against the pending row. Consumes it on success; counts the
 * attempt on failure. Returns the user it belongs to.
 */
async function redeemCode(
  purpose: OtpPurpose,
  code: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const otpId = await readPending();
  if (!otpId) return { ok: false, error: "Start again — the code has expired" };

  const row = await db.otpCode.findUnique({
    where: { id: otpId },
    select: { id: true, userId: true, purpose: true, codeHash: true, attempts: true, expiresAt: true, consumedAt: true },
  });
  if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Start again — the code has expired" };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Request a new code." };
  }
  if (row.codeHash !== hashCode(code)) {
    await db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Request a new code." };
  }

  await db.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { ok: true, userId: row.userId };
}

/* -------------------------------------------------------------------------- */
/* Sign in / up / out                                                         */
/* -------------------------------------------------------------------------- */

export type StepResult =
  | { ok: true; next: string; note: string | null }
  | { ok: false; error: string; field?: string };

export async function signIn(email: string, password: string, ip: string | null): Promise<StepResult> {
  const limited = await throttled("signin", email, ip);
  if (limited) return { ok: false, error: limited };

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, firmId: true, passwordHash: true, mustChangePassword: true },
  });
  // Verify even when the user is missing so timing does not reveal existence.
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) return { ok: false, error: GENERIC_SIGN_IN_ERROR };
  await reset(keyFor("signin:subject", email));

  // This browser already proved a code for this account, and that trust has
  // neither expired nor been revoked — so the second factor is remembered
  // rather than asked for again. The password above was still required.
  if (await deviceIsTrusted(user.id)) return completeSignIn(user, "device");

  const otpId = await issueCode(user.id, user.email, "SIGN_IN");
  await setPending(otpId);
  return {
    ok: true,
    next: "/verify",
    note: mailIsConsoleOnly() ? "No email provider is configured: the code was written to the server log." : null,
  };
}

/**
 * The last step of every sign-in: record it, start the session, and say
 * where to go next. Shared by the code path and the trusted-device path so
 * the two can never drift apart.
 */
async function completeSignIn(
  user: { id: string; firmId: string; mustChangePassword: boolean },
  via: "code" | "device",
): Promise<StepResult> {
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), emailVerifiedAt: new Date() },
    });
    await recordAudit(tx, {
      firmId: user.firmId,
      userId: user.id,
      action: "SIGNED_IN",
      entityType: "User",
      entityId: user.id,
      // Which second factor was satisfied, and how, is the question an
      // auditor asks of a sign-in that skipped the code.
      after: { via },
    });
  });
  await clearPending();
  await createSession(user.id);
  return { ok: true, next: user.mustChangePassword ? "/settings?password=1" : "/", note: null };
}

/**
 * Remember this browser, so the next sign-in on it is password-only.
 *
 * The row and its audit entry are written together; the cookie is set only
 * once both are committed, so a browser is never carrying a token the
 * database has no record of.
 */
async function rememberDevice(firmId: string, userId: string, label: string): Promise<void> {
  // Whatever this browser was already carrying, read before the new token
  // replaces it in the cookie jar.
  const previous = await currentDeviceHash();
  const { token, tokenHash, expiresAt } = mintDeviceToken();

  await db.$transaction(async (tx) => {
    // Signing in again on an already-trusted browser replaces that trust
    // rather than adding to it. Without this the old row stays live for
    // thirty days with no cookie pointing at it — unreachable, but sitting
    // in Settings as a second "Chrome on Windows" nobody can tell apart
    // from the real one, which is exactly the list people revoke from.
    if (previous) {
      await tx.trustedDevice.updateMany({
        where: { userId, tokenHash: previous, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const device = await tx.trustedDevice.create({
      data: { userId, tokenHash, label, expiresAt },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "DEVICE_TRUSTED",
      entityType: "TrustedDevice",
      entityId: device.id,
      after: { label, expiresAt: expiresAt.toISOString(), replacedPrevious: previous !== null },
    });
  });
  await setDeviceCookie(token, expiresAt);
}

/**
 * Stop trusting every browser this user has. A new password must not leave
 * a remembered second factor behind on a browser the person may no longer
 * control.
 *
 * Takes the caller's transaction client so the count lands in the same
 * audit row as the password change that caused it — a retired second factor
 * that no record explains is exactly what an auditor would ask about.
 * Returns how many browsers were live.
 */
async function forgetAllDevices(tx: DbClient, userId: string): Promise<number> {
  const { count } = await tx.trustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function verifySignIn(code: string, remember: boolean, label: string): Promise<StepResult> {
  const redeemed = await redeemCode("SIGN_IN", code);
  if (!redeemed.ok) return redeemed;

  const user = await db.user.findUnique({
    where: { id: redeemed.userId },
    select: { id: true, firmId: true, mustChangePassword: true },
  });
  if (!user) return { ok: false, error: "Start again — the code has expired" };

  // Opt-in, and only after the code was actually proved on this browser.
  if (remember) await rememberDevice(user.firmId, user.id, label);
  return completeSignIn(user, "code");
}

export async function signUp(input: {
  firmName: string;
  name: string;
  email: string;
  password: string;
  phone?: string | undefined;
  state: AuState;
  professionalTitle?: string | undefined;
  isTaxAgent: boolean;
  professionalBody?: ProfessionalBody | undefined;
  agentNumber?: string | undefined;
  howHeard?: string | undefined;
}): Promise<StepResult> {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    // Same shape as success from the outside; the person is told to check their email.
    return { ok: false, error: "An account with that email already exists. Sign in instead.", field: "email" };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.$transaction(async (tx) => {
    const firm = await tx.firm.create({
      data: {
        name: input.firmName,
        state: input.state,
        ...(input.howHeard ? { howHeard: input.howHeard } : {}),
      },
      select: { id: true },
    });
    const created = await tx.user.create({
      data: {
        firmId: firm.id,
        email: input.email,
        name: input.name,
        role: "OWNER",
        passwordHash,
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.professionalTitle ? { professionalTitle: input.professionalTitle } : {}),
        // The schema refuses a claim without a body and a number, so these
        // three are set together or the sign-up never reached here.
        isTaxAgent: input.isTaxAgent,
        ...(input.professionalBody ? { professionalBody: input.professionalBody } : {}),
        ...(input.agentNumber ? { agentNumber: input.agentNumber } : {}),
      },
      select: { id: true, email: true, firmId: true },
    });
    await recordAudit(tx, {
      firmId: firm.id,
      userId: created.id,
      action: "USER_INVITED",
      entityType: "User",
      entityId: created.id,
      // The registration claim is audited because it grants the right to
      // verify a tax rule. Marketing attribution is not: it is not a
      // permission and does not belong in an accounting audit trail.
      after: {
        role: "OWNER",
        signUp: true,
        state: input.state,
        isTaxAgent: input.isTaxAgent,
        professionalBody: input.professionalBody ?? null,
      },
    });
    return created;
  });

  const otpId = await issueCode(user.id, user.email, "SIGN_IN");
  await setPending(otpId);
  return {
    ok: true,
    next: "/verify",
    note: mailIsConsoleOnly() ? "No email provider is configured: the code was written to the server log." : null,
  };
}

export async function resendCode(ip: string | null): Promise<StepResult> {
  const otpId = await readPending();
  if (!otpId) return { ok: false, error: "Start again from sign in" };
  const limited = await throttled("resend", otpId, ip);
  if (limited) return { ok: false, error: limited };
  const row = await db.otpCode.findUnique({
    where: { id: otpId },
    select: { purpose: true, user: { select: { id: true, email: true } } },
  });
  if (!row) return { ok: false, error: "Start again from sign in" };
  const next = await issueCode(row.user.id, row.user.email, row.purpose);
  await setPending(next);
  return { ok: true, next: row.purpose === "PASSWORD_RESET" ? "/reset" : "/verify", note: "A new code was sent." };
}

export async function signOut(firmId: string, userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await recordAudit(tx, { firmId, userId, action: "SIGNED_OUT", entityType: "User", entityId: userId });
  });
  await destroySession();
}

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

export async function requestPasswordReset(email: string, ip: string | null): Promise<StepResult> {
  const limited = await throttled("reset", email, ip);
  if (limited) return { ok: false, error: limited };

  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });
  // Always the same answer, so the form cannot confirm whether an email is registered.
  if (user) {
    const otpId = await issueCode(user.id, user.email, "PASSWORD_RESET");
    await setPending(otpId);
  }
  return {
    ok: true,
    next: "/reset",
    note: mailIsConsoleOnly() && user ? "No email provider is configured: the code was written to the server log." : null,
  };
}

export async function resetPassword(code: string, password: string): Promise<StepResult> {
  const redeemed = await redeemCode("PASSWORD_RESET", code);
  if (!redeemed.ok) return redeemed;

  const user = await db.user.findUnique({ where: { id: redeemed.userId }, select: { id: true, firmId: true } });
  if (!user) return { ok: false, error: "Start again — the code has expired" };

  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    const devicesForgotten = await forgetAllDevices(tx, user.id);
    await recordAudit(tx, { firmId: user.firmId, userId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, after: { via: "reset", devicesForgotten } });
  });
  await destroyAllSessions(user.id);
  await clearDeviceCookie();
  await clearPending();
  await createSession(user.id);
  return { ok: true, next: "/", note: null };
}

export async function changePassword(
  firmId: string,
  userId: string,
  current: string,
  password: string,
): Promise<ActionResult> {
  const user = await db.user.findFirst({ where: { id: userId, firmId }, select: { id: true, passwordHash: true } });
  if (!user) return { ok: false, error: "User not found" };
  if (!(await verifyPassword(current, user.passwordHash))) {
    return { ok: false, error: "Your current password is not right", field: "current" };
  }
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    const devicesForgotten = await forgetAllDevices(tx, user.id);
    await recordAudit(tx, { firmId, userId, action: "PASSWORD_CHANGED", entityType: "User", entityId: userId, after: { via: "settings", devicesForgotten } });
  });
  // Other browsers are signed out; this one keeps its session. Every
  // remembered device is retired though, including this one: a new password
  // means the second factor is proved again, everywhere.
  await clearDeviceCookie();
  return { ok: true, id: userId };
}

/* -------------------------------------------------------------------------- */
/* Trusted devices                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The browsers that may skip this person's six-digit code.
 *
 * Scoped to the signed-in user inside their own firm: one person's devices
 * are never another's to see. The token hash is read to mark the current
 * browser and is dropped before the rows leave this function.
 */
export async function listDevices(firmId: string, userId: string): Promise<TrustedDeviceRow[]> {
  const rows = await db.trustedDevice.findMany({
    where: { userId, user: { firmId }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true, tokenHash: true },
  });
  const current = await currentDeviceHash();
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    isCurrent: row.tokenHash === current,
  }));
}

/**
 * Take the trust away from one browser; the next sign-in on it asks for a
 * code again.
 *
 * Ownership is part of the query rather than a check afterwards: the row
 * must belong to this user, in this firm. Another person's device id is
 * simply not found.
 */
export async function revokeDevice(firmId: string, userId: string, deviceId: string): Promise<ActionResult> {
  const device = await db.trustedDevice.findFirst({
    where: { id: deviceId, userId, user: { firmId }, revokedAt: null },
    select: { id: true, label: true, tokenHash: true },
  });
  if (!device) return { ok: false, error: "That device was not found" };

  await db.$transaction(async (tx) => {
    await tx.trustedDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      firmId,
      userId,
      action: "DEVICE_REVOKED",
      entityType: "TrustedDevice",
      entityId: device.id,
      before: { label: device.label },
    });
  });

  // Forgetting the browser you are sitting at should drop its cookie too,
  // or it keeps presenting a token that no longer means anything.
  if ((await currentDeviceHash()) === device.tokenHash) await clearDeviceCookie();
  return { ok: true, id: device.id };
}

/* -------------------------------------------------------------------------- */
/* Team                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTeam(firmId: string): Promise<TeamMember[]> {
  const rows = await db.user.findMany({
    where: { firmId },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, isTaxAgent: true, lastLoginAt: true, createdAt: true, mustChangePassword: true },
  });
  return rows;
}

export type InviteResult =
  | { ok: true; id: string; temporaryPassword: string | null }
  | { ok: false; error: string; field?: string };

/**
 * Add a team member with a temporary password they must change on first
 * sign-in. The password is emailed; when no mailer is configured it is shown
 * once to the person who invited them, and never stored in the clear.
 */
export async function inviteUser(
  firmId: string,
  invitedBy: string,
  input: { name: string; email: string; role: UserRole },
): Promise<InviteResult> {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) return { ok: false, error: "That email already has an account", field: "email" };

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const id = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { firmId, name: input.name, email: input.email, role: input.role, passwordHash, mustChangePassword: true },
      select: { id: true },
    });
    await recordAudit(tx, {
      firmId,
      userId: invitedBy,
      action: "USER_INVITED",
      entityType: "User",
      entityId: created.id,
      after: { email: input.email, role: input.role },
    });
    return created.id;
  });

  await getMailer().send({
    to: input.email,
    subject: "You have been added to Accountant Genie",
    text: `${input.name}, you have been added to an Accountant Genie firm as ${input.role.toLowerCase()}.\n\nSign in with this temporary password and change it straight away:\n${password}\n`,
  });

  return { ok: true, id, temporaryPassword: mailIsConsoleOnly() ? password : null };
}

export async function changeRole(
  firmId: string,
  actorId: string,
  userId: string,
  role: UserRole,
): Promise<ActionResult> {
  const user = await db.user.findFirst({ where: { id: userId, firmId }, select: { id: true, role: true } });
  if (!user) return { ok: false, error: "User not found" };
  if (user.id === actorId) return { ok: false, error: "You cannot change your own role" };
  if (user.role === "OWNER") {
    const owners = await db.user.count({ where: { firmId, role: "OWNER" } });
    if (owners <= 1 && role !== "OWNER") return { ok: false, error: "A firm needs at least one owner" };
  }
  if (user.role === role) return { ok: true, id: user.id };

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role } });
    await recordAudit(tx, { firmId, userId: actorId, action: "USER_ROLE_CHANGED", entityType: "User", entityId: user.id, before: { role: user.role }, after: { role } });
  });
  return { ok: true, id: user.id };
}

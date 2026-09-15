import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/core/db";

/**
 * A browser that has already proved a one-time code.
 *
 * Sign-in is password + a six-digit code. Asking for the code on every
 * sign-in from the same laptop is friction without safety: an attacker who
 * holds the password and the mailbox passes it anyway. So the second factor
 * is *remembered* for thirty days on a browser that has already proved it,
 * and is asked for again on every other browser, after thirty days, and
 * whenever the password changes.
 *
 * The cookie carries a random token and the database holds only its hash —
 * the same shape as `session.ts`, for the same reason: a database read must
 * never yield a usable credential.
 *
 * Two things make this a shortcut rather than a bypass:
 *
 *   1. The password is still required. Only the second factor is skipped.
 *   2. The lookup is bound to the user signing in, so a device trusted by
 *      one person can never carry another past their code.
 *
 * Minting is split from persisting on purpose: the row and its audit entry
 * are written together by the service, in one transaction, and only then is
 * the cookie set. See .claude/skills/jobs-and-audit/SKILL.md.
 */

export const TRUSTED_DEVICE_COOKIE = "ledgerly_device";
export const TRUST_DAYS = 30;
/** How stale `lastUsedAt` may be before it is refreshed — avoids a write per sign-in. */
const TOUCH_MS = 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// The Settings list names browsers; the naming itself is pure and lives apart.
export { deviceLabel } from "@/server/core/device-label";

/**
 * Whether this browser may skip the one-time code for this user.
 *
 * `userId` is part of the query rather than a check afterwards: a device
 * trusted by one person must not carry another past their second factor.
 */
export async function deviceIsTrusted(userId: string): Promise<boolean> {
  const token = await readDeviceToken();
  if (!token) return false;

  const row = await db.trustedDevice.findFirst({
    where: { tokenHash: hash(token), userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, lastUsedAt: true },
  });
  if (!row) return false;

  if (Date.now() - row.lastUsedAt.getTime() > TOUCH_MS) {
    // Best effort; a failed touch must not fail the sign-in.
    db.trustedDevice.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return true;
}

/**
 * A fresh device token. The caller stores `tokenHash` and `expiresAt` with
 * its audit row, then hands `token` to `setDeviceCookie`. The plaintext
 * token never reaches the database and is never logged.
 */
export function mintDeviceToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hash(token), expiresAt: new Date(Date.now() + TRUST_DAYS * 86_400_000) };
}

export async function setDeviceCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** The hash of the token this browser carries, or null — for "is this the device I am on?". */
export async function currentDeviceHash(): Promise<string | null> {
  const token = await readDeviceToken();
  return token ? hash(token) : null;
}

/** Drop the cookie. The row keeps its `revokedAt`; this only clears the browser. */
export async function clearDeviceCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(TRUSTED_DEVICE_COOKIE);
}

async function readDeviceToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    const token = jar.get(TRUSTED_DEVICE_COOKIE)?.value;
    return token && token.length >= 32 ? token : null;
  } catch {
    // Outside a request — a job, a script, a test — there is no cookie jar.
    // "No trusted device" is the correct answer there, not a crash.
    return null;
  }
}

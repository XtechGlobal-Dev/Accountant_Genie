import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/core/db";
import { rethrowIfSchemaBehind } from "@/server/core/schema-check";
import type { UserRole } from "@/generated/prisma";

/**
 * The only place a firm ID enters the system.
 *
 * A signed-in browser holds a random token in an HTTP-only cookie; the
 * database holds the token's hash. Every request that needs a firm resolves
 * it from here and nowhere else, so services take `firmId` as an argument
 * and never read a request.
 *
 * See .claude/skills/tenant-security/SKILL.md.
 */

export const SESSION_COOKIE = "ledgerly_session";
const SESSION_DAYS = 30;
/** How stale `lastSeenAt` may be before it is refreshed — avoids a write per request. */
const TOUCH_MS = 60 * 60 * 1000;

export interface Session {
  firmId: string;
  userId: string;
  userName: string;
  email: string;
  role: UserRole;
  isTaxAgent: boolean;
  mustChangePassword: boolean;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * The session behind the request's cookie, or null.
 *
 * The one thing it does throw for is a database behind the schema — a stale
 * cookie against missing tables would otherwise 500 every page with a raw
 * stack trace, or loop between / and /sign-in if treated as signed out.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 32) return null;

  const row = await db.session
    .findUnique({
      where: { tokenHash: hash(token) },
      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,
        user: {
          select: {
            id: true,
            firmId: true,
            name: true,
            email: true,
            role: true,
            isTaxAgent: true,
            mustChangePassword: true,
          },
        },
      },
    })
    .catch(rethrowIfSchemaBehind);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_MS) {
    // Best effort; a failed touch must not fail the request.
    db.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  return {
    firmId: row.user.firmId,
    userId: row.user.id,
    userName: row.user.name,
    email: row.user.email,
    role: row.user.role,
    isTaxAgent: row.user.isTaxAgent,
    mustChangePassword: row.user.mustChangePassword,
  };
}

/**
 * The session, or a redirect to sign in. Pages, layouts and server actions
 * all call this; none of them proceeds without a firm.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  // A cookie that no longer maps to a session — expired, signed out
  // elsewhere, or a reset database. Say so, and let the proxy clear it;
  // otherwise the proxy sees a cookie and bounces sign-in straight back here.
  const jar = await cookies();
  redirect(jar.has(SESSION_COOKIE) ? "/sign-in?expired=1" : "/sign-in");
}

/** Start a session for a user and set the cookie. Returns nothing the caller must keep. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { userId, tokenHash: hash(token), expiresAt } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** End the current session and clear the cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hash(token) } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

/** End every session a user holds — after a password change. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

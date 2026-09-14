import "server-only";

import { db } from "@/server/core/db";
import { rethrowIfSchemaBehind } from "@/server/core/schema-check";

/**
 * A fixed-window counter in the database, so it holds across processes and
 * restarts. Used for the things an attacker would hammer: sign-in attempts
 * per email and per address, code requests, password resets.
 *
 * Keys name what is limited, e.g. `signin:email:<email>`. The email is
 * hashed by the caller before it becomes a key so the table never lists
 * addresses in the clear.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the window resets — for a Retry-After style message. */
  retryAfterMs: number;
}

export async function consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date();
  const existing = await db.rateLimit.findUnique({ where: { key } }).catch(rethrowIfSchemaBehind);

  if (!existing || now.getTime() - existing.windowStart.getTime() >= windowMs) {
    await db.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: windowMs - (now.getTime() - existing.windowStart.getTime()),
    };
  }

  await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  return { ok: true, remaining: limit - existing.count - 1, retryAfterMs: 0 };
}

/** Forget a key — after a successful sign-in, so a legitimate person is not locked out later. */
export async function reset(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

export function minutesLeft(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}

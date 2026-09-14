import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { createSession } from "@/server/core/session";

/**
 * Sign in with Google — the OpenID Connect authorization-code flow, done by
 * hand so there is no dependency to keep patched.
 *
 * The browser is sent to Google with a random `state` (kept in a short
 * cookie, compared on return). Google returns a code; the server exchanges
 * it for an ID token and asks Google's tokeninfo endpoint to validate the
 * signature and audience rather than parsing the JWT itself. Only a verified
 * email is accepted. An existing account with that email is linked by its
 * Google subject; there is no silent account creation — a firm is created
 * through sign-up, deliberately.
 */

const STATE_COOKIE = "ledgerly_oauth_state";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export async function beginGoogleSignIn(redirectUri: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Google sign-in is not configured");

  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set(STATE_COOKIE, createHash("sha256").update(state).digest("hex"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleResult = { ok: true; next: string } | { ok: false; error: string };

export async function completeGoogleSignIn(
  code: string | null,
  state: string | null,
  redirectUri: string,
): Promise<GoogleResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { ok: false, error: "Google sign-in is not configured" };

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!code || !state || !expected || createHash("sha256").update(state).digest("hex") !== expected) {
    return { ok: false, error: "The sign-in request did not match. Try again." };
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return { ok: false, error: "Google did not accept the sign-in. Try again." };
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token) return { ok: false, error: "Google returned no identity. Try again." };

  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  if (!info.ok) return { ok: false, error: "Google identity could not be verified." };
  const claims = (await info.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string | boolean };
  if (claims.aud !== clientId || !claims.sub || !claims.email) {
    return { ok: false, error: "Google identity could not be verified." };
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { ok: false, error: "That Google account's email is not verified." };
  }

  const email = claims.email.toLowerCase();
  const user =
    (await db.user.findUnique({ where: { googleSubject: claims.sub }, select: { id: true, firmId: true, mustChangePassword: true } })) ??
    (await db.user.findUnique({ where: { email }, select: { id: true, firmId: true, mustChangePassword: true } }));
  if (!user) {
    return { ok: false, error: "No Accountant Genie account uses that Google email. Create a firm first, then sign in with Google." };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { googleSubject: claims.sub, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    });
    await recordAudit(tx, {
      firmId: user.firmId,
      userId: user.id,
      action: "SIGNED_IN",
      entityType: "User",
      entityId: user.id,
      after: { via: "google" },
    });
  });
  await createSession(user.id);
  return { ok: true, next: user.mustChangePassword ? "/settings?password=1" : "/" };
}

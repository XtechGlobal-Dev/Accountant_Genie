import "server-only";

import { fiskilConfig } from "./config";
import { FiskilConfigError } from "./errors";

/**
 * Fiskil access tokens.
 *
 * They live 15 minutes (`expires_in: 900`) and there are NO refresh tokens —
 * you re-exchange the client credentials. So the token is cached in memory
 * with a safety margin, and concurrent callers collapse into a single fetch:
 * a burst of API calls must not become a burst of token exchanges.
 *
 * In-memory is the right scope. The cache is per process, costs one extra
 * exchange per cold start, and keeps the credential out of any shared store.
 */

const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TTL_SECONDS = 900;

interface TokenResponse {
  token?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

async function exchange(): Promise<string> {
  const config = fiskilConfig();
  if (!config) {
    throw new FiskilConfigError(
      "Fiskil is not configured. Add FISKIL_CLIENT_ID and FISKIL_CLIENT_SECRET to server/.env.",
    );
  }

  const response = await fetch(`${config.baseUrl}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new FiskilConfigError(
      "Fiskil rejected the API key pair. Check FISKIL_CLIENT_ID and FISKIL_CLIENT_SECRET in " +
        "server/.env against console.fiskil.com → Settings → API Keys.",
    );
  }
  if (!response.ok) {
    // The body is Fiskil's, not ours, and never contains our secret — the
    // request is JSON we sent, not echoed back.
    const body = await response.text().catch(() => "");
    throw new Error(`Fiskil token exchange failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const body = (await response.json()) as TokenResponse;
  const token = body.token ?? body.access_token;
  if (!token) throw new Error("Fiskil token response contained no token");

  const ttlMs = (body.expires_in ?? DEFAULT_TTL_SECONDS) * 1000;
  cached = { token, expiresAt: Date.now() + ttlMs - EXPIRY_MARGIN_MS };
  return token;
}

export async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (inFlight) return inFlight;
  inFlight = exchange().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Drop the cached token so the next call re-exchanges. Used on a mid-flight 401. */
export function invalidateToken(): void {
  cached = null;
}

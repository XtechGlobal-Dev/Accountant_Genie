import "server-only";

/**
 * Fiskil configuration, read from `server/.env` and nowhere else.
 *
 * Read lazily rather than at module load: the reconciliation tests, the seed
 * script and the typecheck all import this transitively, and none of them
 * should need a credential to run.
 *
 * The API key pair and the webhook signing secret are INDEPENDENT. The key
 * pair authorises outbound calls; the signing secret verifies inbound
 * webhooks and is only issued once a publicly reachable endpoint is
 * registered. Local development normally has the first and not the second.
 */

export interface FiskilConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  /** Sent as `X-Fiskil-Version` on every request. */
  apiVersion: string;
}

const DEFAULT_BASE_URL = "https://api.fiskil.com";
const DEFAULT_VERSION = "v3";

export function fiskilConfig(): FiskilConfig | null {
  const clientId = process.env.FISKIL_CLIENT_ID?.trim();
  const clientSecret = process.env.FISKIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    baseUrl: (process.env.FISKIL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiVersion: process.env.FISKIL_API_VERSION?.trim() || DEFAULT_VERSION,
  };
}

export function fiskilConfigured(): boolean {
  return fiskilConfig() !== null;
}

/** The base64 signing secret from Console → Settings → Webhooks. */
export function webhookSecret(): string | null {
  return process.env.FISKIL_WEBHOOK_SECRET?.trim() || null;
}

export function webhookConfigured(): boolean {
  return webhookSecret() !== null;
}

/**
 * Where Fiskil returns the client after the hosted consent flow. Only the
 * redirect flow uses these; the Link SDK ignores them, but the API accepts
 * them either way, so they are always sent when set.
 */
export function consentRedirects(): { redirectUri?: string; cancelUri?: string } {
  const redirectUri = process.env.FISKIL_REDIRECT_URI?.trim();
  const cancelUri = process.env.FISKIL_CANCEL_URI?.trim();
  return {
    ...(redirectUri ? { redirectUri } : {}),
    ...(cancelUri ? { cancelUri } : {}),
  };
}

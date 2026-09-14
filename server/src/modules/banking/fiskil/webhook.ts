import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { webhookSecret } from "./config";

/**
 * Verifying a Fiskil webhook signature.
 *
 * Fiskil signs each delivery with HMAC-SHA256 in `X-Fiskil-Signature`.
 *
 * CONFIRMED 2026-09-11 against the authoritative Webhooks guide
 * (docs.fiskil.com/data-api/guides/core-concepts/webhooks, "Verifying Webhook
 * Signatures"): the base64 signing secret is base64-DECODED to bytes,
 * HMAC-SHA256 is taken over the payload, and the digest is compared as
 * BASE64. That is exactly what this implements.
 *
 * Fiskil's own `get_code_examples` snippets say something different — HMAC
 * over the raw secret STRING, compared as HEX — and they are wrong. The same
 * generator also reads `event` from the top level when the guide and the
 * documented payload nest it under `data`, and its banking snippet calls
 * endpoints that do not exist. Treat those snippets as unreliable; the guide
 * and the API reference are authoritative.
 *
 * The whitespace-stripped variant is kept because the guide's OWN OpenSSL
 * recipe pipes the body through `tr -d '\n '` before digesting, so a delivery
 * verified that way is legitimate. It still requires the shared secret, so it
 * widens no attack surface. A hex digest is deliberately NOT accepted — there
 * is a test pinning that, which will fail loudly if Fiskil ever switches.
 */

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Length is not secret and timingSafeEqual throws on a mismatch.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function digest(secret: Buffer, payload: Buffer | string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

export type VerifyOutcome = "ok" | "unconfigured" | "invalid";

/**
 * @param rawBody the exact bytes received, BEFORE any JSON parsing. A
 *   re-serialised object produces a different digest and will never match.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | null): VerifyOutcome {
  const configured = webhookSecret();
  // Without a secret we cannot authenticate the sender at all, so we refuse
  // rather than trust the payload. Reported separately from a bad signature so
  // a missing config does not read as an attack in the logs.
  if (!configured) return "unconfigured";
  if (!signature) return "invalid";

  const secret = Buffer.from(configured, "base64");
  if (secret.length === 0) return "unconfigured";

  if (safeEqual(digest(secret, rawBody), signature)) return "ok";

  const stripped = rawBody.toString("utf8").replace(/[\n ]/g, "");
  return safeEqual(digest(secret, stripped), signature) ? "ok" : "invalid";
}

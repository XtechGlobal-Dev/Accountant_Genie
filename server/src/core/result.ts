import "server-only";

import type { ZodError } from "zod";
import type { ActionResult } from "@/shared/contracts/result";

/**
 * The translation between validation failures and the shape a form can render.
 *
 * Actions never throw at the client boundary: a thrown error in a server action
 * reaches the browser as an opaque digest, which tells a user filling in an ABN
 * nothing. Everything expected — invalid input, a record the firm does not own
 * — comes back as `{ ok: false }` with a message and, where it applies, the
 * field to focus.
 */

export function ok(id?: string): ActionResult {
  return id === undefined ? { ok: true } : { ok: true, id };
}

export function fail(error: string, field?: string): ActionResult {
  return field === undefined ? { ok: false, error } : { ok: false, error, field };
}

/** The first issue only — a form highlights one field at a time. */
export function invalid(error: ZodError): ActionResult {
  const first = error.issues[0];
  return fail(first.message, String(first.path[0] ?? "") || undefined);
}

/**
 * A record the session firm does not own is reported as absent, never as
 * forbidden — "forbidden" would confirm that the ID exists in another tenant.
 */
export function notFound(what: string): ActionResult {
  return fail(`${what} not found`);
}

/**
 * What every server action returns.
 *
 * Kept in `shared/` because both sides depend on it: actions build it, forms
 * render it. A discriminated union so `result.error` is only reachable once
 * `ok` has been checked.
 */
export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; field?: string };

/**
 * What became of one outbound email.
 *
 * `sent`   — a provider accepted it.
 * `logged` — no provider is configured, so it went to the server log.
 * `failed` — a provider refused it; the reason is in the server log.
 *
 * The last two are the same fact to whoever was waiting for the message: it
 * did not arrive. They differ in what the operator should do about it, so the
 * UI is told which and can say something true either way — rather than
 * assuming, as it once did, that a missing provider is the only explanation.
 *
 * Lives here because the transport sets it and a client component renders it.
 */
export type MailOutcome = "sent" | "logged" | "failed";

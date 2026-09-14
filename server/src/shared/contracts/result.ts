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

import { createHash } from "node:crypto";

/**
 * A stable identity for a statement row, so importing the same file twice —
 * or two overlapping exports — cannot create the row twice. Enforced by the
 * `@@unique([bankAccountId, fingerprint])` constraint, which makes re-import
 * idempotent by construction rather than by careful code.
 *
 * The normalised description is used rather than the raw one so a bank that
 * re-renders the same transaction with a different reference suffix still
 * matches.
 */
export function fingerprint(
  bankAccountId: string,
  date: Date,
  amountCents: number,
  normalised: string,
): string {
  return createHash("sha256")
    .update(`${bankAccountId}|${date.toISOString().slice(0, 10)}|${amountCents}|${normalised}`)
    .digest("hex");
}

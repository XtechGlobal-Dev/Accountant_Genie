import "server-only";

import type { UserRole } from "@/generated/prisma";
import type { ActionResult } from "@/shared/contracts/result";

/**
 * Permissions are granular; roles map to them in exactly one place — here.
 * Code checks a permission, never a role, so a role can gain or lose a
 * capability without touching every call site.
 *
 * Every permission declared here is checked somewhere. A permission nobody
 * checks is a promise the product does not keep, so adding one means adding
 * the check that uses it in the same change.
 *
 * Deletion permissions do not exist on purpose: accounting records are
 * archived, deactivated, excluded or reversed — never deleted — so there is
 * no `client:delete` or `transaction:delete` to grant.
 *
 * See .claude/skills/tenant-security/SKILL.md.
 */

export type Permission =
  | "client:create"
  | "client:read"
  | "client:update"
  | "client:archive"
  | "transaction:read"
  | "transaction:update"
  | "transaction:approve"
  | "transaction:exclude"
  | "journal:create"
  | "journal:post"
  | "journal:reverse"
  | "memory:manage"
  | "account:manage"
  | "register:manage"
  | "statement:upload"
  | "report:read"
  | "report:export"
  | "bas:prepare"
  | "bas:approve"
  /** Sign off a tax rule version or a flagged account treatment. Held by the
   *  roles that carry professional responsibility; the action additionally
   *  requires the person to be recorded as a registered tax agent. */
  | "tax:verify"
  | "billing:read"
  | "billing:manage"
  | "organisation:manage"
  | "users:manage"
  | "audit:read";

const ALL: readonly Permission[] = [
  "client:create", "client:read", "client:update", "client:archive",
  "transaction:read", "transaction:update", "transaction:approve", "transaction:exclude",
  "journal:create", "journal:post", "journal:reverse",
  "memory:manage", "account:manage", "register:manage", "statement:upload",
  "report:read", "report:export", "bas:prepare", "bas:approve", "tax:verify",
  "billing:read", "billing:manage", "organisation:manage", "users:manage", "audit:read",
];

const ACCOUNTANT: readonly Permission[] = ALL.filter(
  (p) => !["billing:manage", "organisation:manage", "users:manage"].includes(p),
);

const BOOKKEEPER: readonly Permission[] = [
  "client:read", "client:update",
  "transaction:read", "transaction:update", "transaction:approve", "transaction:exclude",
  "journal:create", "journal:post",
  "memory:manage", "register:manage", "statement:upload",
  "report:read", "report:export", "bas:prepare",
];

const STAFF: readonly Permission[] = [
  "client:read", "transaction:read", "transaction:update", "statement:upload", "report:read",
];

const VIEWER: readonly Permission[] = ["client:read", "transaction:read", "report:read"];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  OWNER: new Set(ALL),
  ADMIN: new Set(ALL),
  ACCOUNTANT: new Set(ACCOUNTANT),
  BOOKKEEPER: new Set(BOOKKEEPER),
  STAFF: new Set(STAFF),
  VIEWER: new Set(VIEWER),
};

export function permissionsFor(role: UserRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export function can(session: { role: UserRole }, permission: Permission): boolean {
  return ROLE_PERMISSIONS[session.role].has(permission);
}

/**
 * Whether this person may sign off a tax rule or a tax treatment: the
 * permission AND the professional registration, never one alone. A
 * self-declared registration on a role without the permission verifies
 * nothing; a permission without the registration verifies nothing either.
 */
export function canVerifyTax(session: { role: UserRole; isTaxAgent: boolean }): boolean {
  return can(session, "tax:verify") && session.isTaxAgent;
}

/**
 * The form-shaped refusal. Says what, not why the caller is who they are.
 * Generic so actions with richer result unions can return it unchanged; the
 * failure shape `{ ok: false, error }` is common to all of them.
 */
export function forbidden<T = ActionResult>(): T {
  return { ok: false, error: "You do not have permission to do that" } as unknown as T;
}

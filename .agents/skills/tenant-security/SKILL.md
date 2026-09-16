---
name: tenant-security
description: Multi-tenant isolation, RBAC and IDOR prevention for this codebase. Load BEFORE writing or reviewing any route handler, server action, service function or Prisma query that reads or writes tenant data, and any code handling permissions, sessions or file uploads. Triggers on route, API, server action, query, findUnique, permission, role, auth, session, upload, tenant, firm, client access.
---

# Tenant security

One accounting firm seeing another firm's client books is an unrecoverable, business-ending event.
This is the highest-risk area in the product.

## The rule

Every query is effectively:

```sql
WHERE firm_id = <the authenticated user's firm>
```

The firm ID comes from the **server-side session**. It never comes from a request body, a query
string, a header, or a URL segment.

## Never trust an ID from the client

This is the defect class that will actually happen:

```ts
// WRONG — the ID exists, so it is returned. Any user can read any transaction.
const tx = await db.bankTransaction.findUnique({ where: { id: params.id } });
```

```ts
// RIGHT — ownership is part of the query, not checked after it.
const { firmId } = await requireSession();
const tx = await db.bankTransaction.findFirst({
  where: { id: params.id, bankAccount: { client: { firmId } } },
});
if (!tx) notFound();
```

Prefer `findFirst` with the ownership path over `findUnique` followed by a check. The scoped query
cannot be forgotten halfway down a function; a post-hoc check can.

Return **404, not 403**, for a resource in another tenant. A 403 confirms the record exists.

## Authorisation chain

Every mutating request verifies, in order:

```
authenticated user → firm membership → permission → resource ownership
```

All four. Frontend route guards are UX, not security — the API is the boundary, and it must assume the
frontend is hostile.

Roles: `OWNER · ADMIN · ACCOUNTANT · BOOKKEEPER · STAFF · CLIENT · VIEWER`

Permissions are granular, not role checks scattered through the code:
`client:create` `client:read` `client:update` `client:delete` · `transaction:read` `transaction:update`
`transaction:delete` `transaction:approve` · `journal:create` `journal:post` `journal:reverse` ·
`report:read` `report:export` · `bas:prepare` `bas:approve` · `billing:read` `billing:manage` ·
`organisation:manage` `users:manage`

Check the permission, never the role. Roles map to permissions in one place.

## Server components and server actions

Next.js server components and server actions are API surface. Every one of them re-authenticates and
re-authorises. Do not assume a parent layout already checked — layouts do not re-run on every
navigation, and a server action can be invoked directly.

```ts
export async function moveTransaction(txId: string, accountId: string) {
  "use server";
  const { firmId, userId } = await requireSession();
  await requirePermission(userId, "transaction:update");
  // ...ownership-scoped query for BOTH txId and accountId
}
```

Note the second half: when a request references two resources, **both** must be ownership-checked.
Moving your own transaction into another firm's account is still a tenant breach.

## File uploads

Never trust the browser's filename, `Content-Type`, or extension.

Validate extension · validate MIME by content sniffing · validate size · scan for malware · generate a
safe server-side filename · store in object storage outside the web root · process asynchronously.

Uploaded statements are retained for audit. They contain a client's complete financial history — scope
access to them exactly as tightly as the transactions they produced.

## Webhooks

Verify the signature. Check the event ID for replay. Store the event. Process. Mark processed.
An unverified webhook is an unauthenticated write endpoint.

## What must never be logged

Passwords · API keys · bank credentials · session tokens · full account numbers · dates of birth ·
complete financial records. Never in logs, AI prompts, analytics, error messages, or URLs.

## Testing

Maintain an automated IDOR suite that enumerates every route and asserts that a user from Firm A
receives 404 for every resource belonging to Firm B. Run it in CI. It should grow every time a route
is added — a route without an IDOR test is not finished.

Consider Postgres row-level security on the highest-risk tables as defence in depth.

## Before you finish

- [ ] Does the firm ID come from the session, never the request?
- [ ] Is ownership part of the query rather than a check afterwards?
- [ ] Are **all** referenced resources ownership-checked, not just the primary one?
- [ ] Is the permission checked server-side, and is it a permission not a role?
- [ ] Does a cross-tenant request return 404?
- [ ] Is there an IDOR test for this route?

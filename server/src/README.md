# The backend

Everything under `server/src/` is the backend. Nothing in `app/`, `app/_features/`
or `app/_ui/` may import from a repository, a service or `core/` except through the
narrow doors described below.

This is not a convention that relies on people remembering it. `core/db.ts`
imports `server-only`, and every repository and service imports it too, so a
client component that reaches the backend — however indirectly — fails the
build with a named error rather than shipping a Prisma client to the browser.
`app/_ui/primitives.tsx` imports `client-only` for the same reason in reverse.

---

## The layers

```
app/            Routes. Resolve the session, call a service, render. Nothing else.
features/       Feature UI. Talks to the backend only through server actions.
ui/             Design system. Knows nothing about the domain.
shared/         Isomorphic: contracts, formatters, labels, enum types.
                ── the only thing both sides are allowed to import ──
server/
  core/         db · session · result. The session is resolved here and only here.
  au/           GST, financial year, chart of accounts. The Australian tax core.
  ai/           Provider interface. Behind it, never called directly by a route.
  modules/      One folder per area of the domain.
```

The dependency rule is one-directional: `app` → `server/src/modules` → `server/src/core`,
and both sides may import `shared`. A module may call another module's **service**
or **repository**; it may never reach into another module's `actions.ts`.

---

## Module anatomy

Four files, in the order data moves through them:

| File | Responsibility | May import |
|---|---|---|
| `schema.ts` | Zod input contracts, and the `FormData` adapters that feed them. No I/O, so it is testable without a request. | `zod` |
| `repository.ts` | Prisma queries. Every one takes `firmId` and puts it **inside** the `where`. | `core/db` |
| `service.ts` | Domain rules and cross-module composition. Takes `firmId` as an argument; returns contracts or `null`. | repositories, other services |
| `actions.ts` | `"use server"`. Session, validate, call the service, `revalidatePath`. | `core/session`, `core/result`, its own schema and service |

Two rules make the split worth having:

**Services never read the session.** `firmId` is a parameter, which makes tenancy
a signature requirement rather than an ambient one — a service that forgot to
scope will not compile, and the same service is callable from a job, a script or
a test.

**Services never import `next/*`.** They return data or `null`. Whether a missing
record becomes a 404 page or a form error is the caller's decision, and the
caller is the only one who knows.

---

## Tenancy

Ownership is part of the query, never a check afterwards.

```ts
// Yes — another firm's ID matches nothing.
db.client.findFirst({ where: { id: clientId, firmId } })
db.client.updateMany({ where: { id: clientId, firmId }, data })

// No — the guard can be forgotten, and often is.
const client = await db.client.findUnique({ where: { id: clientId } });
if (client.firmId !== firmId) throw new Error("forbidden");
```

A record the firm does not own is reported as **absent**, never as forbidden:
"forbidden" confirms the ID exists in another tenant. Services return `null`,
actions return `notFound(...)`, pages call `notFound()`.

## Session and permissions

`core/session.ts` resolves the signed-in user from an HTTP-only cookie whose
token is stored hashed. `requireSession()` redirects to sign-in; pages,
layouts and every server action call it, because a layout does not re-run on
navigation and an action is callable directly. `proxy.ts` adds an
optimistic redirect for browsers with no cookie — UX, not the boundary.

Roles map to permissions once, in `core/permissions.ts`. A mutating action
checks a permission, never a role:

```ts
const session = await requireSession();
if (!can(session, "journal:post")) return forbidden();
```

See `.claude/skills/tenant-security/SKILL.md`.

---

## Contracts

`server/src/shared/contracts/` holds the read models the backend hands the frontend. They
are not database rows: a page asks for the shape it renders, which keeps
`select` lists honest and stops a column added for one screen leaking into every
other one.

Money crosses this boundary as **integer cents** and becomes a string only in
`server/src/shared/format.ts`.

---

## Testing note

`server-only` throws outside the React server condition, so a test runner needs
it aliased to an empty module — in Vitest, `resolve.alias: { "server-only": ... }`.
Schemas and pure services are testable as they are; repositories need a database.

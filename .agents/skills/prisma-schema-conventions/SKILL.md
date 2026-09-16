---
name: prisma-schema-conventions
description: Schema and data-access conventions for this codebase — money fields, constraints, migrations, soft deletion, concurrency and indexing. Load BEFORE editing prisma/schema.prisma, writing a migration, or adding a model, field, enum or index. Triggers on schema, model, migration, prisma, index, constraint, column, field, enum, database.
---

# Prisma & schema conventions

## Money

Every monetary field is `Int`, named with a `Cents` suffix: `amountCents`, `gstCents`, `debitCents`.

Never `Float`. Never `Decimal` for transaction amounts — cents are exact and remove all
marshalling friction. A single line is capped near $21.4M (Int max), which is acceptable for SMB
books; aggregate in JS `number`, which stays exact to 2^53 cents.

If a single line ever legitimately needs to exceed $21M, that is a schema decision requiring
discussion — not a silent switch to `Float`.

## Naming

- Models `PascalCase` singular — `BankTransaction`, not `bank_transactions`
- Fields `camelCase`
- Enums `SCREAMING_SNAKE_CASE` values
- Foreign keys `<model>Id`
- Booleans read as assertions — `isSystem`, `gstRegistered`, `isCashAtBank`

## Every model carries

- `id String @id @default(cuid())`
- `createdAt DateTime @default(now())`
- A path to `firmId`, directly or through a relation. **A model with no tenancy path is a defect** —
  it cannot be safely queried. Check this before adding any model.

## Constraints belong in the database

Application logic alone is insufficient. Encode invariants where they cannot be bypassed:

- `CHECK (debit_cents >= 0)` and `CHECK (credit_cents >= 0)` on journal lines
- `@@unique([bankAccountId, fingerprint])` — makes re-import idempotent by construction
- `@@unique([code, firmId, clientId])` on accounts
- `@@unique([firmId, clientId, pattern])` on memory rules
- `onDelete: Restrict` on `JournalLine.account` — an account with postings can never be deleted
- `onDelete: Cascade` only where the child genuinely has no meaning without the parent

## Deletion policy

Accounting records are **not** hard-deleted.

| Record | Policy |
|---|---|
| Posted journal entry | Never deleted. Reverse and correct. |
| Account with postings | Deactivate, never delete (`Restrict` enforces this) |
| Bank transaction, posted | Void or exclude |
| Bank transaction, imported not posted | Hard delete permitted under explicit permission |
| Bank account | Disconnect first, then delete — and only with its data |

Add `isActive` / `deactivatedAt` rather than reaching for `DELETE`.

## Migrations

Every schema change is a migration. **Never** modify a production schema by hand.

- Forward-compatible where possible — add before you remove
- Reviewed before merge
- Tested against a copy of production-shaped data
- Documented rollback strategy
- **Back up before any financial-data migration**

`prisma db push` is for local prototyping only. Staging and production use `prisma migrate deploy`.

## Concurrency

Two accountants will edit the same transaction. Do not silently overwrite one of them.

Add a `version Int @default(0)` column to concurrently-edited records, increment on write, and reject
a stale write with a conflict the UI can surface. Losing a colleague's correction without telling
anyone is worse than an error message.

## Transactions

Any operation touching multiple accounting records runs inside `db.$transaction`. All succeed or all
roll back. A partially-applied move — transaction updated, journal not — is corruption.

```ts
await db.$transaction(async (tx) => {
  await tx.bankTransaction.update({ ... });
  await tx.journalEntry.create({ ... });
  await tx.auditLog.create({ ... });
});
```

The audit row belongs **inside** the transaction. An audit log that can diverge from what it records
is not an audit log.

## Indexing

Index what you filter and sort on: `[bankAccountId, date]`, `[status]`, `[clientId, date]`,
`[firmId]`. Review query plans when the transaction table passes ~100k rows — the review screen must
stay fast at 10k+ rows in a single view.

## Client instantiation

Import the singleton from `server/src/core/db.ts`. Never `new PrismaClient()` in a route, service or
component — Next.js hot reload will exhaust the connection pool within a few edits.

## Before you finish

- [ ] Money as `Int` cents with a `Cents` suffix?
- [ ] Does the model have a path to `firmId`?
- [ ] Are invariants enforced by DB constraints, not just code?
- [ ] Is deletion prevented where records are accounting history?
- [ ] Is this a migration, not a hand edit?
- [ ] Are multi-record writes wrapped in a transaction with the audit row inside?

---
name: jobs-and-audit
description: Background job design and audit logging for this codebase — idempotency, retry, partial failure, stage events, progress streaming, and what every accounting mutation must record. Load BEFORE writing or reviewing any worker, queue job, import pipeline, webhook handler, scheduled task, or any code that mutates accounting data. Triggers on job, queue, worker, BullMQ, background, import, webhook, retry, idempotent, audit, progress, SSE.
---

# Jobs & audit

## Nothing large runs synchronously

A statement import can be 10,000 rows. Imports, reconciliation, and large report generation all run as
background jobs. The request returns a job ID; the UI subscribes to progress.

```
Upload → validate → store original → scan → identify format → parse
  → normalise → deduplicate → save transactions → reconcile
```

Each stage is persisted, not just logged. Persisted stages give retry, resume, monitoring, audit and a
progress UI for free.

## Idempotency is mandatory

Workers get retried. Webhooks arrive twice. A user double-clicks. **Running twice must never create
duplicate accounting records.**

Mechanisms, in order of preference:
1. **Unique constraints** — `@@unique([bankAccountId, fingerprint])` makes duplicate import
   structurally impossible, which is better than any amount of careful code
2. Idempotency keys on usage events and webhook events
3. Job execution IDs

Operations that must be idempotent: import statement · sync bank feed · reconcile transaction ·
create usage event · process webhook · generate report.

Test it directly: run the job twice, assert the row count is unchanged. Make this a standing test, not
a one-off check.

## Retry and dead-lettering

Exponential backoff, bounded attempts, then a dead-letter state. **Never silently lose a failed
accounting job.** A failed import that vanishes is a client's missing quarter.

Failed jobs must be visible in the admin dashboard and retryable by a human.

## Partial failure

10,000 rows, 50 fail. Do not fail the file.

Persist the 9,950. Record the 50 with their reasons. Offer download-failed-rows and retry-failed-rows.
The exception is a failure that compromises accounting integrity — then roll the batch back entirely
and say so.

The same applies to bulk review actions: validate every record individually, return per-record
results, and never let one bad record corrupt the batch.

## Progress streaming

Server-Sent Events to the Activity Panel:

```json
{ "jobId": "...", "stage": "RECONCILING", "processed": 800, "total": 1200,
  "message": "Reconciled 800 transactions" }
```

Stages: `UPLOADING · FILE_VALIDATION · PARSING · TRANSACTIONS_SAVED · DEDUPLICATING · RECONCILING ·
GST_PROCESSING · FINALIZING · COMPLETED · FAILED`

The user must be able to navigate away while the job runs and come back to accurate state. Progress
is read from persisted stage rows, never from in-memory worker state.

## Audit logging

Every accounting mutation writes an audit row answering:

**who · what · when · why · before · after · source**

```
id · firmId · userId · clientId · action · entityType · entityId
before(jsonb) · after(jsonb) · ip · userAgent · timestamp
```

Actions include: `TRANSACTION_RECLASSIFIED` · `GST_CHANGED` · `ACCOUNT_CREATED` ·
`ACCOUNT_DEACTIVATED` · `JOURNAL_POSTED` · `JOURNAL_REVERSED` · `BAS_GENERATED` · `CLIENT_UPDATED` ·
`BANK_CONNECTED` · `BANK_DISCONNECTED` · `MEMORY_CREATED` · `MEMORY_DELETED`

Rules:
- **Append-only.** Audit rows are never updated or deleted.
- Written **inside** the same database transaction as the change. An audit log that can diverge from
  what it claims to record is worse than none, because it is trusted.
- For AI-driven changes, additionally record model, prompt version, rules version, memory version and
  confidence.

## Lineage

A user must be able to click any figure and walk back to its origin:

```
BAS figure → BAS line → tax rule version → journal lines → bank transactions
  → statement import → uploaded file
```

Keep the foreign keys that make this possible. Do not drop `importId` or `journalEntryId` because a
row "doesn't need it" — that link is the product's defensibility.

## Job model

```
id · firmId · clientId · type · status · progress · currentStage
inputReference · errorCode · errorMessage
startedAt · completedAt · createdAt
```

Plus a `JobEvent` child table, one row per stage transition.

## Before you finish

- [ ] Does anything long-running block a request?
- [ ] Is the operation idempotent, ideally by unique constraint?
- [ ] Did you run it twice in a test and assert no duplicates?
- [ ] Do failures dead-letter visibly rather than disappear?
- [ ] Does partial failure preserve the successes?
- [ ] Is an audit row written inside the same DB transaction?
- [ ] Are the lineage foreign keys preserved?

# Jobs

Background work that must not run inside a request: statement imports, client-wide
reconciliation, bank feed syncs.

## Shape

- `queue.ts` — `enqueue()` writes a `Job` row (idempotent on `idempotencyKey`) and dispatches
  it. With `REDIS_URL` the dispatch is a BullMQ job that `scripts/worker.ts` picks up; without
  it the job runs in-process after the response. `runJob()` is the single runner both use:
  it marks the row RUNNING, calls the handler, retries with backoff and finally marks DEAD.
- `handlers.ts` — one function per `JobType`. Handlers take a `StageReporter` and call it at
  each stage; the reporter writes a `JobEvent` and updates progress on the row.
- `service.ts` — read side for the Activity Panel and the SSE route.
- `app/api/jobs/[id]/events/route.ts` — Server-Sent Events, session-scoped, polling the
  events table so it works with or without Redis.

## Rules

- A handler receives `firmId` from the job row, never from a request. Everything it touches is
  filtered by that firm.
- Handlers are idempotent. A retried import must not insert its rows twice — the transaction
  fingerprint unique constraint is what guarantees that, not a flag.
- Failures are recorded on the job (`lastError`, `attempts`) and surfaced in the Activity
  Panel with a Retry button; they are never swallowed.
- Never log the contents of an uploaded statement or a feed response.

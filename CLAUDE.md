# CLAUDE.md

Guidance for Claude Code when working in this repository.

---

## 1. What this is

**Accountant Genie** — a multi-tenant Australian AI accounting and bookkeeping platform for accounting firms
and bookkeepers.

Bank data comes in (CSV, PDF, or live feed). Transactions are normalised, deduplicated, coded against
an Australian chart of accounts with the correct GST treatment, and posted to a double-entry ledger.
Accountants review the exceptions rather than doing the coding. Reports — P&L, Balance Sheet, Trial
Balance, General Ledger, BAS, TPAR, depreciation, EOFY — derive from that one ledger.

It is **not** lodgement software. We prepare, review and export. We do not lodge to the ATO.

Current status: **pre-prototype.** See `docs/PHASE-PLAN.md` for phases, milestones and gates.

---

## 2. The governing principle

> **AI proposes. Deterministic accounting rules validate. Professionals approve. The ledger is the
> source of truth.**

Everything in this repository is subordinate to that sentence. If a change would let the AI write to
the ledger without a deterministic validation gate and a human sign-off path, it does not ship,
regardless of how well it tests.

Three consequences worth internalising:

1. **The ledger is built before the AI.** A wrong P&L is worse than no P&L.
2. **Abstention is always allowed.** "Unknown, needs review" is a correct answer and is never
   penalised. False auto-approval is the metric that matters, not raw accuracy.
3. **Every number is traceable.** Report figure → BAS line → journal line → transaction → statement
   row → uploaded file.

---

## 3. Clean-room rule

This product is independently implemented. We build from publicly documented *product behaviour* —
what the workflows are — never from another vendor's implementation.

**Permitted:** public help documentation, public pricing pages, general Australian accounting and ATO
rules, our own designs.

**Prohibited:** copying another vendor's source code, private prompts, internal algorithms, database
schemas, branding, wordmarks, UI assets, copy text, or screenshots. Do not name a competitor in
product UI, marketing copy, or code comments.

Our own naming, used consistently: **Command Bar** (Ctrl/Cmd-K) · **Activity Panel** (job progress) ·
**Coding Memory** (learned classification rules).

---

## 4. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js **16.3.4** App Router | Server Components + Server Actions |
| UI | React **19.2.8**, Tailwind **4.3.3** | Dense, professional, keyboard-first |
| Language | TypeScript **5.9**, `strict: true` | |
| DB | **Neon** (serverless Postgres) | Pooled URL for the app, **direct URL for migrations**. Docker is NOT used. |
| ORM | Prisma **7.10.0** | **Pin both `prisma` and `@prisma/client` to 7.10.0** |
| Validation | Zod **4.5.4** | Also used for AI structured output |
| AI | `@anthropic-ai/sdk` **0.123.0**, model `claude-opus-5` | Behind a provider interface |
| Bank feeds | **Fiskil** (CDR accredited data recipient), API `v3` | `@fiskil/link` in the browser; all credentials server-side |
| Jobs | Redis + BullMQ | From Phase 3 |
| Storage | S3 / Cloudflare R2 | From Phase 3; local disk only in the prototype |
| Billing | Stripe | From Phase 8 |

**Version warning:** `prisma@latest` currently resolves to `8.0.0-rc.12` (a release candidate) while
`@prisma/client@latest` is `7.10.0`. Installing either unpinned produces a mismatched pair. Both are
pinned to `7.10.0` in `package.json` — do not "helpfully" upgrade them.

### Why not NestJS

The research documents in `docs/` recommend a separate NestJS backend. We build a **Next.js modular
monolith** instead: one deployable, one language, no duplicated DTOs, and Server Components remove
most of the API layer that recommendation assumes. This is consistent with the same document's advice
to *"start with a modular monolith, do not prematurely create microservices."*

Domain logic lives in `server/src/modules/*`, **never in route handlers or components**, and the
boundary is enforced by `server-only` rather than by discipline — see §7. Extraction to a separate
service stays possible if scale demands it.

---

## 5. Project skills — load these

Seven skills in `.claude/skills/` encode the rules that matter most. **Load the relevant one before
writing code in its area** — they exist because these mistakes are invisible until an accountant or an
auditor finds them.

| Skill | Load before touching |
|---|---|
| `au-tax-rules` | GST, BAS, financial years, tax codes, depreciation thresholds |
| `double-entry-ledger` | Journals, posting, opening balances, money, any ledger-derived report |
| `reconciliation-engine` | Classification pipeline, coding memory, confidence and risk |
| `ai-classification` | Any Anthropic API call, prompt, output schema, or AI result |
| `tenant-security` | Any route, server action, or tenant-scoped query |
| `prisma-schema-conventions` | `schema.prisma`, migrations, new models or indexes |
| `jobs-and-audit` | Workers, imports, webhooks, and any accounting mutation |

Also load the bundled **`claude-api`** skill before writing Anthropic SDK code — model IDs and API
shapes have changed and training priors are frequently stale.

---

## 6. Rules that are not negotiable

Violating any of these is a defect regardless of test status.

### Money
- **Integer cents everywhere.** Every field named `...Cents`, typed `Int`.
- Never floating point for money. Convert at the edges only.
- Negative = money out.

### Tax
- **`GST = gross / 11`** for GST-inclusive AU amounts — never `× 0.10`. Use `server/src/au/gst.ts`.
- **Never invent a tax rule.** Uncertain rules go behind a versioned abstraction marked
  `REQUIRES_VERIFICATION` and are escalated to the registered tax advisor.
- Tax rules are versioned with `effective_from` / `effective_to` and never updated in place.
- **An LLM never calculates a tax figure.** It may classify; it may not compute.

### Ledger
- Every journal balances: `SUM(debits) === SUM(credits)`. Enforced in service, DB constraint and test.
- Minimum two lines. Exactly one of debit/credit non-zero per line.
- **Posted entries are immutable.** Corrections are reversal + correcting entry.
- One reporting layer over the ledger. Reports never contain their own accounting arithmetic.

### Tenancy
- The firm ID comes from the **server-side session**, never from the request.
- Ownership is part of the query, not a check afterwards. Prefer `findFirst` with the ownership path.
- Cross-tenant access returns **404, not 403**.
- Every route needs an IDOR test.

### AI
- Structured output via Zod. **Never parse free-form text for an accounting decision.**
- Always check `stop_reason === "refusal"` before reading content; always handle null `parsed_output`.
  Both route to human review.
- Full validation gate before anything reaches the ledger.
- Store lineage: model, prompt version, rules version, memory version, confidence.
- Prompts live on disk under `prompts/`, versioned — never inline in business logic.

### Data
- Accounting records are not hard-deleted. Void, reverse, or deactivate.
- Multi-record writes run in `db.$transaction`, with the audit row **inside** the transaction.
- Background operations are idempotent — ideally by unique constraint.
- Never log secrets, credentials, tokens, full account numbers, or unnecessary PII.

---

## 7. Layout

The frontend and the backend are **two packages in one npm workspace**, and the root reads
as exactly that: `app/` is the frontend, `server/` is the backend, and there is nothing else
at the top level but `public/`, `docs/` and the Next.js config files.

`server/` owns its own `package.json`, `tsconfig.json` and `.env`, and declares its own
dependencies — Prisma, Zod, Stripe, BullMQ, the AI SDK, the S3 client. npm hoists a workspace's
packages to the root `node_modules`, so those are physically resolvable from either side; the
boundary that actually holds is `server-only`, below. `next` is declared a *peer* of the server
package and provided by the root, which npm satisfies by deduplication — one copy of React and
Next in the process, not two. `npm ls react next` is how you check that still holds.

The boundary is still enforced by code, not convention: `core/db.ts` and every repository and
service import `server-only`, so a client component that reaches the domain fails the build.
`app/_ui/primitives.tsx` imports `client-only` for the mirror-image reason.

`shared/` lives at `server/src/shared/` because the backend imports it in 51 files — putting it
on the frontend side would invert the dependency and make the two packages circular. The
frontend still reaches it as `@/shared/...`; only the alias moved.

**No source file's import statements changed in the move.** Path aliases carry the old forms:

| Import form | Resolves to |
|---|---|
| `@/server/...` | `server/src/...` |
| `@/shared/...` | `server/src/shared/...` |
| `@/generated/...` | `server/generated/...` (git-ignored Prisma output) |
| `@/ui/...` | `app/_ui/...` |
| `@/features/...` | `app/_features/...` |

```
app/                          ── FRONTEND (root package) ──────────────────
  (app)/ (auth)/ api/ feed/   Routes: resolve the session, call a service, render
  layout.tsx · globals.css
  _features/                  Feature UI by domain area — shell/ clients/ banking/ …
  _ui/                        Design system — primitives.tsx · styles.ts · icons.tsx
proxy.ts                      Optimistic sign-in redirect (Next 16). Must sit at the root.
public/                       Static assets
next.config.ts                Also loads server/.env into the Next process
package.json · tsconfig.json · postcss.config.mjs

server/                       ── BACKEND (@ledgerly/server) ───────────────
  package.json                Backend dependencies, isolated from the frontend
  tsconfig.json               Standalone typecheck
  .env · .env.example         Every secret. No NEXT_PUBLIC_* vars exist.
  src/
    README.md                 Layer rules and module anatomy — read before adding a module
    core/
      db.ts                   Prisma singleton — always import this, never `new PrismaClient()`
      session.ts              The only place a firm ID enters the system
      result.ts               Zod failure → ActionResult, for form-shaped errors
    au/                       gst.ts · fy.ts · coa.ts   ← Australian tax core
    ai/                       Provider interface — never called directly from a route
    jobs/                     Job queue: in-process runner, or BullMQ worker
    shared/                   Read models crossing the boundary. Money stays integer cents.
      contracts/ · enums.ts · format.ts · labels.ts
    modules/                  One folder per area of the domain, four files each:
      clients/                    schema.ts      Zod input contracts + FormData adapters
      banking/                    repository.ts  Prisma queries, firmId inside every `where`
      accounts/                   service.ts     Domain rules; takes firmId, returns contracts
      firms/                      actions.ts     "use server" — session, validate, call, revalidate
      ingest/ reconcile/ ledger/ reports/ …
  prisma/                     schema.prisma · migrations · seed.ts · sql/
  prompts/                    Versioned AI prompts
  scripts/                    worker.ts · check-connection.ts · list-models.ts
  tests/                      IDOR suite and the server-only test shim
  samples/                    Demo bank statement for the seeded firm
  vitest.config.ts · vitest.idor.config.ts · prisma.config.ts

scripts/                      Cross-package automation — `npm run dev` lives here (see its README)
docs/PHASE-PLAN.md            Phases, milestones, gates, risks
docs/tools/                   Playwright screenshot + PDF rendering for the docs
.claude/skills/               Project skills (§5)
```

**Domain logic never lives in `app/`.** A route resolves the session, calls a service in
`server/src/modules/`, and renders. No Prisma, no business rules, no `select` lists.

**Services never read the session and never import `next/*`.** `firmId` is an argument, which
makes tenancy a signature requirement rather than an ambient one and keeps every service
callable from a job, a script or a test. Services return data or `null`; whether that means a
404 page or a form error is the caller's decision.

**The frontend reaches the backend through exactly two doors:** a server action imported from a
module's `actions.ts`, and a contract type from `@/shared/contracts/`. Nothing else.

---

## 8. Commands

```bash
npm install          # installs BOTH packages (npm workspace)
npm run dev          # ← the only command needed to run locally

# `npm run dev` (scripts/dev.mjs) does the backend first, then the frontend:
#   1. loads server/.env — creates it from .env.example and stops if absent
#   2. one npm install at the root if node_modules is missing
#   3. prisma generate
#   4. prisma db push + ledger CHECK constraints
#   5. seeds ONLY if the Firm table is empty
#   6. next dev, plus the BullMQ worker when REDIS_URL is set,
#      then opens the browser once the app answers
#
#   npm run dev -- --port 4000   different port
#   npm run dev -- --seed        force a reseed
#   npm run dev -- --no-open     do not open a browser
#   npm run dev:fast             skip steps 3-5
#   npm run dev:app              raw `next dev`, no preflight

npm run db:check     # verify both Neon connection strings
npm run fiskil:check # prove the Fiskil credentials against the live API (read-only)
npm run fiskil:check -- --transactions   # also sample payloads and re-verify the field mapping
npm run db:push      # sync schema (LOCAL ONLY — never staging/production)
npm run db:seed      # seed AU chart of accounts + demo data
npm run db:studio    # Prisma Studio
npm run db:reset     # destructive: reset + reseed
npm run db:purge-demo  # delete the seeded "Meridian Accounting" demo firm and everything under it; other firms untouched
npm test             # unit tests (offline)
npm run test:idor    # cross-tenant suite (needs a real database)
npm run worker       # BullMQ worker
```

Every backend command at the root is a thin delegate to the server package
(`npm run <script> --workspace @ledgerly/server`), which runs it with `server/` as its cwd — which is
why each backend entry point finds `server/.env` by loading a plain `.env` relative to itself.
You can also run them from inside `server/` directly.

Staging and production use `prisma migrate deploy`. Never `db push` outside local development.

`FISKIL_CLIENT_ID` / `FISKIL_CLIENT_SECRET` (in `server/.env`) enable live bank feeds.
`FISKIL_WEBHOOK_SECRET` is separate and optional — it is issued only when a publicly
reachable webhook endpoint is registered, so local development leaves it blank and uses
**Sync now** instead. Without it `/api/webhooks/fiskil` returns 503 rather than trusting an
unauthenticated payload.

`ANTHROPIC_API_KEY` (in `server/.env`) is required for the AI tier. The rules and memory tiers run without it, and
`MockProvider` runs the whole pipeline offline — use it for tests.

---

## 9. Current state

**Feature-complete prototype across the phase plan, with the hardening list built.** Built:

- `server/prisma/schema.prisma` — firms (plan, Stripe ids), users (roles, passwords, Google subject),
  sessions, trusted devices, one-time codes, rate limits, clients, partners, accounts, bank accounts (feed ids),
  feed requests and connections, imports (stored file, stage, failed rows), transactions
  (coding, lineage, review state), journals and lines (GST snapshot, subcontractor link),
  coding memory, assets (car flag), loans, subcontractors, jobs and job events, versioned tax
  rules, webhook events, append-only audit log
- `server/prisma/migrations/` — baseline plus `20260908000001_constraints` (journal-line `CHECK`s,
  entry total, partner share, `NULLS NOT DISTINCT` on the system-account code index). Local
  dev still uses `db push` + `npm run db:constraints`; staging/production use `migrate deploy`.
- `server/src/core/` — Prisma singleton; cookie session; `trusted-device.ts` (second-factor
  memory) + `device-label.ts`; `permissions.ts`; `password.ts`;
  `audit.ts`; `rate-limit.ts` (DB-backed, per subject and per IP); `mail.ts` (console or
  Resend); `storage.ts` (local disk or S3-compatible)
- `server/src/jobs/` — `Job`/`JobEvent` queue: in-process runner by default, BullMQ worker
  (`npm run worker`) when `REDIS_URL` is set; retries with backoff, DEAD state, idempotency key;
  SSE progress at `/api/jobs/[id]/events` drives the Activity Panel and the upload modal
- `server/src/au/` — GST treatments and the `/11` arithmetic, financial year helpers, ~70-account
  Australian chart of accounts
- Modules: `auth` (sign-in + email code, throttled; sign-up, reset, change password, team,
  roles; Google OIDC when configured; **trusted devices** — a browser that has proved a
  code may skip it for 30 days, opt-in per browser, bound to the user, listed and
  revocable under Settings, and retired wholesale by any password change), `clients` (partners with shares for partnerships and trustee + beneficiaries for trusts, each taken as the second step of New Client and editable on the entity tab; a logo per client, sniffed as PNG/JPEG/WebP, kept in storage under the firm and served only through `/clients/[id]/logo`), `banking` (accounts, feed requests with a
  public token page, feed connections via a provider interface with a **Fiskil** implementation
  (CDR consents, auth sessions + Link SDK, live accounts and balances, webhook-driven sync),
  feed sync job), `ingest` (CSV and PDF parsing, dedup by fingerprint, stored original, job
  stages), `reconcile` (memory → rules → AI with validation gate, risk, review, Coding Memory; a
    live feed's own category rides along to the AI tier as weak corroborating evidence
    under `prompts/transaction-classification/v2.md`, and a recode of a fed transaction
    is pushed back to Fiskil by `banking/category-feedback.ts` — only ever as a category
    Fiskil itself supplied, since their taxonomy is unpublished),
  `accounts` (system + custom chart, CSV export, tax-agent verification of flagged
  treatments), `ledger`, `reports` (P&L, Balance Sheet, Trial Balance, General Ledger,
  Transactions, Simple BAS with lineage, TPAR, Depreciation, EOFY; Xero CSV and MYOB TXT
  journal export; every report route shows the ways in until the client has a transaction or a journal), `assets` (category, amount paid and GST beside the depreciable cost), `loans` (facility type), `subcontractors`, `billing` (plans, Stripe Checkout,
  Customer Portal, signature-verified webhook with replay guard), `firms`, `tax-rules`
  (versioned values with `effective_from/to`; anyone proposes, only a tax agent verifies;
  depreciation thresholds and BAS W1/W2 mapping are read from verified versions and are
  otherwise not applied), `support` (in-app support form → email, throttled per person)
- UI: sign-in flow with a six-box code entry; app shell as a floating white sidebar and no
  top bar — brand, plan pill, support, account menu, Command Bar trigger, firm modules,
  client search and list, and, once a client is open, that client's sections nested under
  it (Client Info ▾ Basic Info / Business Entity / Opening Balance, Transactions, Journals,
  Chart of Accounts, Banks, Depreciation, Loans, Reports ▾ nine reports, Subcontractors,
  Coding Memory), usage meter and Add New Client at the foot; the orb opens the Activity
  Panel. Home is a centred welcome with the FY quarter timeline, then stat cards, the
  monthly chart, the work queue and recent imports. Clients list (count, centred search,
  archived toggle, bulk archive). Client workspace pages, firm-wide Transactions /
  Reconciliation / Reports, chart with All / System / Custom pills, settings with its own
  side list (profile, subscription with three plan cards, team, tax rules, audit trail),
  `/help` documentation page. The structure mirrors the workflow the firm already knows;
  every label, asset and line of copy is our own (§3).
- Tests: `npm test` (unit, offline) and `npm run test:idor` (cross-tenant suite against a real
  database — every service must answer "not found" for another firm's records)

**Integrations that are wired but not exercised end to end here:** Stripe, Resend, Google
sign-in, S3 storage, BullMQ, and the Fiskil feed provider each activate from environment
variables documented in `.env.example`. They compile and are guarded, but have not been run
against live credentials in this repository.

**Fiskil's webhook signature scheme is CONFIRMED** (2026-09-11, against their
Webhooks guide): base64-decode the signing secret, HMAC-SHA256 the payload, compare a
base64 digest, and read the event name from `data.event` — not the top level.
`banking/fiskil/webhook.ts` implements exactly that.

**Fiskil's own `get_code_examples` snippets are unreliable and must not be trusted over
the guide or the API reference.** They state the opposite signature scheme (hex over the
raw secret), destructure `event` from the top level, and call banking endpoints that do
not exist. This was checked, not assumed.

**The `TransactionV2` field list is unpublished, so it was CONFIRMED FROM THE WIRE**
(2026-09-11, 781 live sandbox transactions). Four of the obvious assumptions were wrong,
and every one of them fails silently — `npm run fiskil:check -- --transactions` is what
proved them and is what re-proves them when Fiskil changes something:

| Field | The trap |
|---|---|
| `posting_date_time` | NOT `posted_date_time`. The near-miss is the danger: the fallback to execution still yields a date, so rows look fine while `postedAt` is permanently null. |
| `category.{primary,secondary}_category` | NESTED, not flat. A flat lookup silently drops every category — the signal the AI tier now leans on. |
| `fiskil_id` vs `transaction_id` | Different values on the same row. `fiskil_id` is Fiskil's stable id and is what the category-override endpoint means by `fiskil_transaction_id`; `transaction_id` is the institution's. |
| `status: PENDING` | Carries no date on most rows, a date on some. Unsettled authorisations are skipped entirely — they are not source documents, and they return as POSTED under the same `fiskil_id`. |

Also confirmed: amounts are decimal STRINGS; `merchant_category_code` (ISO 18245) is present
on roughly half of rows and is a standard, unlike Fiskil's own category taxonomy, which is
still unpublished — which is why `category-feedback.ts` only ever sends back a value Fiskil
itself supplied.

**Fiskil's own `get_code_examples` snippets are unreliable and must not be trusted over
the guide or the API reference.** They state the opposite webhook signature scheme (hex over
the raw secret), destructure `event` from the top level, and call banking endpoints that do
not exist. This was checked, not assumed.

The Fiskil docs MCP server is registered at **user scope**
(`claude mcp add --scope user --transport http fiskil https://docs.fiskil.com/api/ai/mcp`)
— use `search_docs`, `get_page` and `get_api_endpoint_details`, and prefer the guides and
the API reference over `get_code_examples`.

**Still open:** the registered tax advisor has to verify the seeded rule proposals and enter
the instant asset write-off and car limit amounts under Settings → Tax rules before those
figures affect any report. Low-value pooling is not modelled.

## 10. Working style in this repo

**Read before writing.** Check `server/prisma/schema.prisma`, `server/src/README.md` and the relevant
`server/src/modules/` module first.
Reuse existing abstractions rather than adding parallel ones.

**Order of work for any feature:** domain model → types → schema → business rules → service → route
→ UI → tests → security review → audit review. Never start with UI and invent the backend after.

**Definition of done:** working · type-safe · unit tested · integration tested where applicable ·
input validated · permissions checked · audit handled · errors handled. All eight.

**For every database mutation, ask:** Is it tenant-isolated? Idempotent? Auditable? Reversible? Can
concurrent edits corrupt it? Does it affect the ledger? GST or BAS? Can historical reports still
reproduce?

**For every AI operation, ask:** What is the structured input and output? What deterministic rules
validate it? What happens if it fails, or confidence is low, or the account is invalid? How is the
decision audited, and which versions produced it?

**Ask rather than guess** on Australian tax treatment. Every tax rule needs sign-off from the
registered tax advisor. This is the one area where a confident guess is worse than a question.

---

## 11. Key metrics

| Metric | Target |
|---|---|
| Auto-reconciliation rate | ≥ 85% |
| First-pass accuracy | ≥ 90% |
| **False auto-approval rate** | **≤ 0.5%** |
| Rules + memory resolution before any AI call | ≥ 60% |
| Review time per 100 transactions | ≤ 10 min |

False auto-approval is the number the business lives or dies on. A transaction sent to review costs
fifteen seconds; one confidently auto-approved into the wrong account costs a wrong BAS and the
client. **When in doubt, abstain.**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

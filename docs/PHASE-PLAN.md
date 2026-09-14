# Accountant Genie — Phase & Milestone Plan

**Australian AI accounting & bookkeeping platform**
Independent, clean-room implementation informed by publicly documented competitor workflows.

| | |
|---|---|
| **Document owner** | ai@xtecglobal.com |
| **Created** | 4 September 2026 |
| **Status** | Awaiting client approval of Stage 0 prototype |
| **Working name** | Accountant Genie |

---

## 1. How to read this plan

The build is split into **two commitments**, separated by a hard approval gate:

```
STAGE 0  ──►  ◆ CLIENT APPROVAL GATE ◆  ──►  PHASES 1–11
Prototype                                    Production build
3–4 weeks                                    ~10 months
Fixed, small                                 Staged, invoiced per phase
```

Nothing in Phases 1–11 is committed or resourced until the client signs off Stage 0.
Stage 0 is deliberately scoped so that **if the client says no, the loss is four weeks — not four months.**

Estimates assume the team in §9. They are working estimates, not fixed-price quotes.

---

## 2. Governing principle

> **AI proposes. Deterministic accounting rules validate. Professionals approve. The ledger is the source of truth.**

Every phase below is subordinate to that sentence. If a feature would let the AI write to the ledger
without a deterministic validation gate and a human sign-off path, it does not ship.

Three corollaries that shape the architecture:

1. **The ledger is built before the AI.** A wrong P&L is worse than no P&L. Double-entry correctness
   is a Phase 2 deliverable; AI classification is Phase 4.
2. **Abstention is a valid answer.** "Unknown, needs review" is always an acceptable AI output and is
   never penalised. False auto-approval is the metric that matters, not raw accuracy.
3. **Every number is traceable.** Report figure → BAS line → tax rule → journal line → transaction →
   statement row → uploaded file. This is what makes the product defensible to a professional.

---

## 3. Clean-room position (read before writing any code)

This product is **independently implemented**. We build from publicly documented *product behaviour*
— what the workflows are — never from another vendor's implementation.

**Permitted:** public help documentation, public pricing pages, public marketing claims, general
Australian accounting and ATO rules, our own designs.

**Prohibited:** copying another vendor's source code, private prompts, internal algorithms, database
schemas, branding, wordmarks, UI assets, copy text, or screenshots. Do not name a competitor in
product UI, marketing, or code comments. Do not reuse their account codes as a set, their exact
screen names, or their feature names verbatim as our own product nouns.

Where our naming would otherwise collide, we choose our own: *Ezy Actions* → **Command Bar**;
*Ezyiah Assistant* → **Activity Panel**; *AI Memory* → **Coding Memory**.

---

## 4. Stage 0 — Prototype (client approval gate)

**Duration:** 3–4 weeks · **Goal:** earn the "yes" · **Audience:** the client, and 1–2 friendly accountants

### 4.1 What the prototype must prove

The client is not buying a screen. They are buying a claim. The prototype exists to make one claim
undeniable in a live demo:

> *"Upload two years of bank statements. Watch them code themselves. Correct three. Watch it learn.
> Produce a BAS you'd actually hand to a tax agent."*

### 4.2 Scope — build this

| # | Deliverable | Notes |
|---|---|---|
| P1 | Single-tenant app shell, dense professional UI | No signup; one seeded demo firm, hard-coded session |
| P2 | Client workspace with 2 seeded demo clients | Company + Sole Trader, to show entity differences |
| P3 | Australian chart of accounts (~65 accounts) | With GST treatments — already built |
| P4 | CSV bank statement upload with column mapping | Real parsing, real dedup by fingerprint |
| P5 | Reconciliation pipeline: rules → memory → Claude | Real Claude API calls, structured output, batched |
| P6 | Deterministic GST engine | `GST = gross / 11`, four AU treatments |
| P7 | Review screen: dense table, filters, inline recode | Keyboard-first: A/E/M/N shortcuts |
| P8 | Coding Memory — "remember for this client / all clients" | The flywheel moment in the demo |
| P9 | **Two reports: Profit & Loss + Simple BAS** | BAS mapped to real ATO labels G1 / 1A / 1B / W1 |
| P10 | Click-through lineage on one BAS figure | 1A → contributing transactions → source file |
| P11 | Seeded demo dataset: ~800 realistic AU transactions | The single highest-leverage asset in the demo |

### 4.3 Explicitly OUT of Stage 0

Cut ruthlessly. These are Phase 1+ and must not creep in:

- Authentication, signup, password reset, MFA, RBAC
- Multi-tenancy enforcement (single hard-coded firm is fine)
- Live bank feeds / CDR / Open Banking
- PDF statement parsing (CSV only — demo with CSV)
- Background job queue (synchronous processing on a small dataset is fine)
- Balance Sheet, Trial Balance, General Ledger, TPAR, assets, depreciation, loans, EOFY
- Billing, Stripe, usage metering
- Audit log UI, admin dashboard, notifications
- Object storage (local disk is acceptable **for the prototype only**)
- Any export to Xero / MYOB

### 4.4 Prototype acceptance criteria

Stage 0 is done when, in a single unrehearsed 15-minute session, we can:

- [ ] Upload a CSV of ~800 transactions and watch them reconcile with visible progress
- [ ] Show ≥ 85% of transactions auto-coded, remainder correctly routed to **Unknown** for review
- [ ] Recode one transaction, choose "remember for this client", re-run, show it stick
- [ ] Produce a P&L that a qualified accountant agrees is structurally correct
- [ ] Produce a Simple BAS where 1A and 1B are arithmetically verifiable by hand
- [ ] Click 1A and see the exact transactions behind it
- [ ] Show the deliberate failure mode: a genuinely ambiguous transaction abstaining rather than guessing

### 4.5 Demo risk register

| Risk | Mitigation |
|---|---|
| Live Claude call fails on stage | Pre-warmed cache + recorded-response fallback mode behind a flag |
| Accountant spots a GST error | Have the AU advisor review every seeded transaction's expected coding **before** the demo |
| "Is this just ChatGPT?" | Lead with the rules-first pipeline diagram and the abstention behaviour |
| Client asks about bank feeds | Have the CDR accreditation answer ready (§10.1) — do not improvise it |

### 4.6 Gate decision

The client's approval must be explicit and cover: scope of Phases 1–8, commercial terms, and
acceptance that ATO lodgement is **out of scope for v1**.

---

## 5. Production build — phase overview

| Phase | Name | Duration | Cumulative | Ships |
|---|---|---|---|---|
| 1 | Foundations | 3 wks | 3 wks | Auth, tenancy, RBAC, audit spine |
| 2 | Accounting core | 4 wks | 7 wks | CoA, ledger, journals, opening balances |
| 3 | Ingestion | 3 wks | 10 wks | CSV + PDF, storage, queues, dedup |
| 4 | Reconciliation intelligence | 5 wks | 15 wks | Rules, AI, GST engine, memory, risk |
| 5 | Review workflow | 3 wks | 18 wks | Review queue, bulk ops, split/move |
| 6 | Reporting & BAS | 5 wks | 23 wks | P&L, TB, BS, GL, Transactions, BAS |
| 7 | Platform | 3 wks | 26 wks | Activity panel, jobs, notifications, admin |
| 8 | Commercial | 2 wks | 28 wks | Stripe, plans, usage metering |
| | **◆ Commercial MVP — first paying firm ◆** | | **~6.5 months** | |
| 9 | Specialist compliance | 5 wks | 33 wks | TPAR, assets, depreciation, loans, EOFY |
| 10 | Integrations | 6 wks | 39 wks | Live bank feeds, Xero/MYOB export |
| 11 | Hardening & launch | 4 wks | 43 wks | Security, DR, pen test, compliance |
| | **◆ General availability ◆** | | **~10 months** | |

Phases 1–3 have hard sequencing. Phases 9 and 10 can run in parallel with a second pair of hands.
CDR accreditation (§10.1) must start **at Phase 1**, not Phase 10 — it is the longest lead-time item
in the entire programme.

---

## 6. Phase detail

### Phase 1 — Foundations *(3 weeks)*

Everything that is painful to retrofit.

**Milestones**
- M1.1 Monorepo structure, CI (lint, typecheck, test), environment separation dev/staging/prod
- M1.2 Postgres schema v1 with constraints: `CHECK (debit >= 0)`, `CHECK (credit >= 0)`, unique
  fingerprints, FK integrity. Migrations only — never manual schema edits.
- M1.3 Authentication: email/password, email OTP verification, Google OAuth, password reset, sessions
- M1.4 Organisation/firm model, membership, roles: `OWNER · ADMIN · ACCOUNTANT · BOOKKEEPER · STAFF · CLIENT · VIEWER`
- M1.5 Granular permissions (`transaction:approve`, `journal:post`, `bas:prepare`, …) enforced
  **server-side on every query** — never by route guard alone
- M1.6 Append-only audit log with before/after, actor, IP, entity — wired into a reusable helper
- M1.7 Structured JSON logging + error monitoring

**Exit criteria** — A user in Firm A cannot read *any* record belonging to Firm B, proven by an
automated IDOR test suite that enumerates every API route.

---

### Phase 2 — Accounting core *(4 weeks)*

The spine. Nothing above this phase is trustworthy until this is provably correct.

**Milestones**
- M2.1 Client CRUD, business identity, ABN, GST registration, industry, notes
- M2.2 Entity engine — Company / Partnership / Sole Trader / Unit Trust / Discretionary Trust, each
  with **modelled** entity-specific fields (not one JSON blob), each driving its own equity accounts
- M2.3 Financial year service — `financialYearOf`, `financialYearRange`, `quarterRange`; nothing
  hardcoded to a current year
- M2.4 System + custom chart of accounts, applicability (this client / all clients / selected),
  deactivate-not-delete when posted transactions exist
- M2.5 Tax code model, **versioned** with `effective_from` / `effective_to` — historical reports must
  reproduce exactly after a rate change
- M2.6 Double-entry ledger: `JournalEntry` + `JournalLine`, balance invariant enforced in code **and**
  by DB constraint, posted entries immutable
- M2.7 Manual journals with live debit/credit/out-of-balance tracker
- M2.8 Opening balances as a real 1-July journal, not detached fields

**Exit criteria** — Trial balance sums to zero on a 10,000-line generated dataset. Posting an
unbalanced journal is impossible through the API, the service layer, and raw SQL.

---

### Phase 3 — Ingestion *(3 weeks)*

**Milestones**
- M3.1 Bank account model: `BANK` / `CREDIT_CARD`, manual vs feed, masked account number
- M3.2 Object storage (S3 / R2) — originals retained for audit; never local disk in production
- M3.3 File security: extension + MIME + size validation, malware scan, safe filename, stored
  outside web root. Never trust the browser's filename or Content-Type.
- M3.4 CSV parser with column detection and a mapping engine (banks disagree on everything)
- M3.5 PDF parser for text-based statements; scanned/image PDFs explicitly rejected with a clear
  message rather than silently mis-parsed
- M3.6 Normalisation: merchant extraction, noise stripping, `normalised` description
- M3.7 Duplicate detection → `DUPLICATE_SUSPECTED`, surfaced for review. **Never auto-delete.**
- M3.8 Redis + BullMQ workers; imports asynchronous with persisted stage events
- M3.9 Partial failure handling: 9,950 succeed / 50 fail → keep both, allow download and retry of the 50

**Exit criteria** — A 10,000-row CSV imports asynchronously; re-running the identical import creates
zero duplicate rows.

---

### Phase 4 — Reconciliation intelligence *(5 weeks)*

The core product. Also the phase where undisciplined engineering produces plausible, wrong books.

**Pipeline — strictly in this order:**

```
normalise → dedup → merchant resolution → coding memory → deterministic rules
   → candidate accounts → AI classification → GST engine → accounting validation
   → confidence + risk → auto-process | review → human correction → memory update
```

**Milestones**
- M4.1 Deterministic rule layer first — transfers, ATO payments, bank fees, interest, wages, loan
  repayments. Target: rules + memory resolve ≥ 60% before any AI call.
- M4.2 AI provider abstraction (`AccountingAIProvider`) with a **Claude implementation and a Mock
  implementation**. The mock is not optional — it is what makes the test suite deterministic and free.
- M4.3 Claude classification: batched (~40 transactions/call), structured output via Zod schema,
  chart of accounts in a **cached** system prompt, model `claude-opus-5`
- M4.4 GST engine — deterministic, never LLM-computed. `GST = gross / 11` for GST-inclusive AU
  amounts. Treatments: `GST · GST_FREE · INPUT_TAXED · BAS_EXCLUDED`.
- M4.5 Validation gate — every AI proposal passes: schema → account exists → account belongs to
  client → account active → tax code valid → GST arithmetic correct → entry balances → risk
  acceptable. Only then is it applied.
- M4.6 Coding Memory: structured (not a vector store), scoped `CLIENT` > `FIRM`, with
  `evidence_count`, editable and deletable by the user, never bypassing validation
- M4.7 Confidence **and** risk. Confidence alone is insufficient: a $50,000 unknown supplier at 0.97
  confidence still goes to review. Risk = amount + novelty + tax impact + account type + inconsistency.
  Thresholds configurable, not hardcoded.
- M4.8 AI decision lineage — model, model version, prompt version, rules version, memory version,
  input hash, output, confidence, decision, timestamp
- M4.9 Prompt versioning on disk (`prompts/transaction-classification/v1…`), never inline in business logic
- M4.10 Golden evaluation dataset (`tests/ai/golden-transactions.json`) + regression gate in CI

**Exit criteria** — On the golden set: ≥ 90% first-pass accuracy on auto-processed items, and
**≤ 0.5% false auto-approval**. The second number is the one that gets us sued if we ignore it.

---

### Phase 5 — Review workflow *(3 weeks)*

The screen accountants live in eight hours a day. Speed here is the product.

**Milestones**
- M5.1 Dense transaction table: date, description, bank, amount, account, GST, net, status, confidence
- M5.2 Filters: FY, quarter, month, bank, account, status, GST, confidence
- M5.3 Per-transaction actions: edit, move, split, void, scan similar
- M5.4 Split with hard invariant `sum(splits) == original` — save blocked otherwise
- M5.5 Move with the memory prompt: *remember for this client / every client / don't remember*
- M5.6 Scan Similar → bulk move / bulk GST update / bulk review, **validated per record**, per-record
  results returned; one failure must not corrupt the batch
- M5.7 Keyboard-first: `A` approve · `E` edit · `M` move · `S` split · `R` remember · `N` next
- M5.8 Risk-prioritised review queue

**Exit criteria** — An accountant reviews 100 transactions in under 10 minutes without the mouse.

---

### Phase 6 — Reporting & BAS *(5 weeks)*

**One reporting layer over one ledger.** Reports must never contain their own accounting maths — that
is how P&L says $50,000 and the trial balance says $49,999.

**Milestones**
- M6.1 Shared reporting layer over `JournalLine`
- M6.2 Profit & Loss — Trading Income, COGS, Gross Profit, OPEX, Other, Net Profit
- M6.3 Trial Balance, with an explicit balance assertion surfaced in the UI
- M6.4 Balance Sheet, with an `Assets = Liabilities + Equity` warning banner when it fails
- M6.5 General Ledger — summary and with-balances views
- M6.6 Transactions Report — count / net / GST / gross per account
- M6.7 **BAS engine** — Simple and Extended. Deterministic, versioned tax rules. Store
  `calculated_value`, `adjustment_value`, `final_value` separately for a real audit trail.
  Labels: G1, 1A, 1B, W1, W2.
- M6.8 Report lineage — click any figure, see contributing transactions, then the source file
- M6.9 Export: PDF, Excel, CSV. Large reports generated as background jobs.

**Exit criteria** — P&L, Trial Balance and BAS agree with each other and with a manually prepared
control set, verified by the AU advisor. Frequency and FY filters produce correct period boundaries
across a 1-July rollover.

**Explicitly not in scope:** ATO lodgement. We prepare, review, export. See §10.2.

---

### Phase 7 — Platform *(3 weeks)*

- M7.1 Job model with persisted stage events supporting retry, resume, monitoring
- M7.2 Idempotency across every background operation — import, reconcile, usage event, webhook, report
- M7.3 Exponential-backoff retry with a dead-letter queue; failed accounting jobs are never lost silently
- M7.4 **Activity Panel** — live job progress via SSE, draggable, upload entry point, stage-by-stage log
- M7.5 **Command Bar** (Ctrl/Cmd-K) — action registry → permission check → validation → handler → audit
- M7.6 Global search (Postgres full-text) across clients, transactions, accounts
- M7.7 Notifications: in-app + email
- M7.8 Admin dashboard: firms, usage, jobs, AI metrics, failed imports, audit. Impersonation requires
  explicit permission, is audited, shows a banner, and is time-limited.
- M7.9 OpenTelemetry: API latency, job duration, queue depth, AI latency, **AI cost**, failure rates

---

### Phase 8 — Commercial *(2 weeks)*

- M8.1 `Plan` / `Subscription` / `Usage` as three separate concepts
- M8.2 Stripe integration; Stripe is never the accounting ledger
- M8.3 Subscription states: `TRIALING · ACTIVE · PAST_DUE · CANCELED · INCOMPLETE · PAUSED` — never a boolean
- M8.4 Append-only usage records with idempotency keys, metered on reconciled transactions
- M8.5 Webhooks: signature verification, event storage, idempotency, replay protection
- M8.6 Free trial allocation + transaction top-up packs

**◆ Milestone: Commercial MVP — onboard the first paying firm ◆**

---

### Phase 9 — Specialist compliance *(5 weeks)*

- M9.1 Subcontractor register with ABN
- M9.2 AI subcontractor identification from reconciled transactions — proposes, human confirms.
  Never auto-create a supplier relationship.
- M9.3 Allocation of payments to subcontractors, with bulk assign
- M9.4 **TPAR** generation and export
- M9.5 Asset register: cost, GST, depreciable cost, method, rate, private use %, effective life, disposal
- M9.6 Deterministic depreciation engine — prime cost and diminishing value; instant asset write-off
  eligibility flagged against a **versioned** threshold rule
- M9.7 Loans: equipment finance, bank loan (+ long-term variants), balloon payments, unexpired interest
- M9.8 Loan repayment splitting into principal / interest / fees — never expensing the whole repayment
- M9.9 EOFY statement derived from ledger + assets + loans, never independently calculated

---

### Phase 10 — Integrations *(6 weeks + accreditation lead time)*

- M10.1 `BankFeedProvider` abstraction — the accounting engine never couples to one provider
- M10.2 CDR/Open Banking via an **accredited intermediary** (see §10.1)
- M10.3 Consent flow: client receives the request, approves at their own bank, we are notified
- M10.4 Historical fetch: live-forward / 1 / 3 / 6 / 12 / 24 months / custom
- M10.5 Scheduled sync, sync-run records, disconnect (preserving history) and delete (permanent, requires disconnect first)
- M10.6 Nominated Representative guidance per bank for business and trust accounts — a genuine
  onboarding blocker that needs first-class documentation, not a support ticket
- M10.7 **Xero / MYOB export** of coded transactions

> **Note on M10.7:** the competitor's marketing claims Xero/MYOB integration, but their own public
> documentation never describes one. This is likely a genuine gap in the market's leading product and
> a real differentiation opportunity — prioritise it, and prove it in the demo.

---

### Phase 11 — Hardening & launch *(4 weeks)*

- M11.1 External penetration test — IDOR, tenant escape, RBAC bypass, upload handling, webhooks
- M11.2 Load testing: large batches, concurrent review, report generation
- M11.3 Backups: daily, PITR, object versioning, monitoring — **and a tested restore.** An untested
  backup is not a backup.
- M11.4 Disaster recovery: RPO < 1 hour, RTO < 4 hours (targets to confirm with the client)
- M11.5 Data residency: Australian hosting, no offshore transfer — AU accounting firms will ask,
  and the answer decides the sale
- M11.6 Privacy Act 1988 / APP compliance review; incident response and breach notification policy
- M11.7 Policy suite: ToS, privacy, AUP, AI use & disclosure, disclaimer, billing/refund, retention
- M11.8 Feature flags for staged rollout: `AI_RECONCILIATION`, `PDF_IMPORT`, `LIVE_BANK_FEEDS`, `BAS`, `TPAR`

---

## 7. Cross-cutting standards (every phase)

**Money.** Integer cents everywhere. Never floating point. `0.1 + 0.2` is a bug report waiting to happen.

**Tenancy.** Every query is effectively `WHERE firm_id = currentFirm`. Frontend-supplied IDs are never
trusted. Consider Postgres row-level security on the highest-risk tables.

**Audit.** Every accounting mutation answers: who, what, when, why, before, after, source. For AI
decisions additionally: which model, prompt, rules, memory, confidence.

**Immutability.** Posted journals are never updated. Corrections are reversal + adjustment entries.

**Testing gates per phase:** unit (money, GST, FY, journal balancing, depreciation, splits, dedup,
confidence, memory matching) · integration (CSV → transaction → reconciliation → journal → report → BAS)
· E2E (signup → client → bank → upload → reconcile → review → report) · security (IDOR, tenant escape,
RBAC, uploads, webhooks) · AI regression against the golden set.

**Definition of done for every phase:** working implementation · type-safe · unit tests · integration
tests · validation · permission checks · audit handling · error handling. No phase starts before the
previous one meets all eight.

---

## 8. Success metrics

**Product**
| Metric | Target at MVP |
|---|---|
| Auto-reconciliation rate | ≥ 85% |
| First-pass accuracy | ≥ 90% |
| **False auto-approval rate** | **≤ 0.5%** |
| Rule + memory resolution (pre-AI) | ≥ 60% |
| Review time per 100 transactions | ≤ 10 min |
| Import success rate | ≥ 99% |
| AI cost per 1,000 transactions | Tracked from Phase 4 day one |

False auto-approval is the metric the business lives or dies on. A confidently wrong BAS is worse
than no BAS. Optimise for it above raw accuracy.

**Commercial** — active firms · active clients · transactions processed · gross margin after AI cost.

---

## 9. Team & required skills

### 9.1 Roles

| Role | Allocation | Responsible for |
|---|---|---|
| Lead full-stack engineer | 1.0 FTE | Architecture, ledger, reconciliation engine |
| Full-stack engineer | 1.0 FTE | Ingestion, UI, reports, integrations |
| **Registered AU tax/BAS agent (advisor)** | 0.4 FTE | Tax rule verification, CoA sign-off, report review, golden dataset |
| Product designer | 0.2 FTE | Dense table UX, review flow, keyboard model |
| DevOps / security | 0.2 FTE from Phase 3 | AU hosting, queues, storage, backups, pen-test remediation |

The tax advisor is **not optional and not part-time-optional**. Every tax rule we ship must be signed
off by a qualified Australian professional. Engineers must never invent a tax rule — uncertain rules
go behind a versioned abstraction flagged `REQUIRES_VERIFICATION`.

### 9.2 Technical skills required

**Essential** — TypeScript (strict) · Next.js 16 App Router + React 19 Server Components ·
PostgreSQL schema design, constraints, transactions, indexing · Prisma · double-entry accounting
fundamentals · Australian GST/BAS mechanics · LLM structured output & prompt engineering ·
Redis/BullMQ · multi-tenant security & RBAC · Zod validation.

**Important** — S3-compatible storage · Stripe subscriptions + usage metering · SSE · Tailwind and
dense data-table UX · CSV/PDF parsing · OpenTelemetry · Docker & CI/CD.

**Valuable** — CDR/Open Banking · Xero/MYOB APIs · OCR · Postgres RLS · Playwright.

### 9.3 Claude Code project skills

Seven skills are installed in `.claude/skills/` to keep AI-assisted development inside the
architectural rules rather than relying on anyone remembering them:

`au-tax-rules` · `double-entry-ledger` · `reconciliation-engine` · `ai-classification` ·
`tenant-security` · `prisma-schema-conventions` · `jobs-and-audit`

---

## 10. Risks requiring a decision now

### 10.1 CDR accreditation — the critical path *(HIGH)*

Live bank feeds under Australia's Consumer Data Right are **not** an ordinary API integration. Data
can only be received by an accredited data recipient or through an accredited intermediary. Direct
accreditation is a months-long, costly compliance process with ongoing audit obligations.

**Recommendation:** launch on an accredited intermediary (Basiq, Fiskil or equivalent) rather than
seeking direct accreditation. Begin commercial and compliance conversations **during Phase 1**, not
Phase 10 — this is the single longest lead-time item in the programme, and Phase 10 will slip without it.

### 10.2 Lodgement and TPB positioning *(MEDIUM)*

We prepare and export; we do not lodge. Preparing BAS data for a fee touches BAS agent regulation, so
the product must be positioned as **AI-assisted bookkeeping under professional review** — never as
replacing an accountant. Obtain Australian legal advice on positioning before marketing copy is written.

### 10.3 Data residency *(MEDIUM)*

Australian accounting firms will ask where client data is stored, and the answer will decide sales.
Commit to Australian hosting with no offshore transfer, and audit every third party — including the
AI provider — against that commitment. Decide the AI inference region **before Phase 4**, because it
constrains provider choice.

### 10.4 AI cost at scale *(MEDIUM)*

Usage-based pricing with per-transaction AI cost means margin is an engineering property, not a
commercial one. Mitigations are built in: rules and memory resolve the majority before any AI call,
batching, prompt caching of the chart of accounts, and per-firm cost telemetry from Phase 4 day one.

### 10.5 Stack divergence from the research documents *(RESOLVED — noting the decision)*

The supplied PRD recommends a NestJS backend separate from the Next.js frontend. We are building a
**Next.js 16 modular monolith** instead: one deployable, one language, no cross-service DTO
duplication, and server components remove most of the API layer the PRD assumes. This is consistent
with that document's own advice — *"start with a modular monolith, do not prematurely create
microservices."* Domain logic still lives in `server/src/modules/*` service modules, never in route handlers, so
extraction to a separate service remains possible if scale ever demands it.

---

## 11. Immediate next actions

| # | Action | Owner | Blocks |
|---|---|---|---|
| 1 | Approve this plan and the Stage 0 scope | Client | Everything |
| 2 | Engage the AU tax/BAS advisor | Us | Phase 2, Phase 4 |
| 3 | Open commercial talks with a CDR intermediary | Us | Phase 10 |
| 4 | Provision Anthropic API key + billing | Us | Stage 0 P5 |
| 5 | Build the seeded demo dataset and have the advisor verify every expected coding | Us + advisor | Stage 0 demo |
| 6 | Confirm final product name and secure the domain | Client | Branding |
| 7 | Australian legal review of positioning and disclaimers | Client | Marketing |

---

*Prepared 4 September 2026. Estimates are working figures based on the team in §9 and assume the
tax advisor is available throughout. Revise after the Stage 0 gate.*

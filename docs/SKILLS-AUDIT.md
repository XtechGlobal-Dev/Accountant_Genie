# Skills Audit — codebase vs `.claude/skills/`

Saat project skills jo rules define karti hain, unke checklist ke against poore codebase ka audit.
16 September 2026, commit `be7ba4c` par. Har finding ke saath file aur line hai.

Severity ka matlab:
- **HIGH** — skill ka non-negotiable rule toota hai, ya aisa gap jo production mein data/tenant/ledger ko galat kar sakta hai.
- **MED** — rule toota hai lekin blast radius chhota hai, ya ek documented deviation jo undocumented hai.
- **LOW** — hygiene, dead code, ya skill khud stale hai.

Jo findings maine khud code kholke dobara verify kiye, unpe ✔ laga hai.

---

## Summary

| Skill | HIGH | MED | LOW | Overall |
|---|---:|---:|---:|---|
| tenant-security | 3 | 7 | 2 | Core tenancy strong hai, lekin 3 real cross-tenant holes |
| double-entry-ledger | 4 | 3 | 3 | Ledger khud sahi hai, Transactions report aur GST sign bypass karte hain |
| au-tax-rules | 3 | 4 | 5 | GST maths perfect, lekin BAS persist nahi hota aur rule versions link nahi hote |
| ai-classification | 3 | 4 | 3 | Guards aur gate sahi, CI aur lineage adhoore |
| reconciliation-engine | 3 | 6 | 4 | Pipeline sahi order mein, candidate generation aur loan split missing |
| prisma-schema-conventions | 2 | 5 | 3 | Naming/constraints clean, migration drift aur no optimistic locking |
| jobs-and-audit | 6 | 9 | 4 | Job queue solid, audit coverage mein bade gaps |

**Cross-cutting (har skill isse maangti hai):**
- **CI bilkul nahi hai.** `.github/workflows` exist nahi karta. `npm test`, `npm run test:idor`, `npm run ai:golden` sab sirf haath se chalte hain. ✔
- **Do skills khud stale hain:** reconciliation-engine `877 Tracking Transfers` aur `999 Unknown` kehti hai, code mein `977` aur `0` hai aur code sahi hai (`server/src/au/coa.ts:154,158`). Skill fix karo, code nahi. ✔

---

## 1. tenant-security

### HIGH

**T1. Recode mein subcontractor ownership check nahi** ✔
`server/src/modules/reconcile/service.ts:195` — `recodeTransaction` transaction aur account dono ownership-check karta hai, lekin `subcontractorId: input.subcontractorId || null` request se seedha likh deta hai. `ledger/service.ts:157-162` mein yahi check sahi hai. Leak: accept ke waqt `subcontractorId` journal line par copy hota hai (`:311`), aur TPAR report `reports/repository.ts:43` se doosre firm ka subcontractor **naam aur ABN** render kar deta hai.

**T2. System account par cross-tenant write** ✔
`server/src/modules/accounts/service.ts:323-341` + `repository.ts:130-138` — `verifyAccountTreatment` `findVisibleAccount` use karta hai jiska `OR` mein `{ firmId: null, clientId: null }` (global system accounts) shaamil hai, phir `updateAccount` se `requiresVerification: false` aur `taxNote` likh deta hai. Ek firm ka user platform ke har firm ke liye verification flag clear kar sakta hai. IDOR suite isse cover nahi karti.

**T3. Self-declared tax agent = sole authorisation** ✔
`server/src/modules/auth/schema.ts:73` — `isTaxAgent` public sign-up form ka checkbox hai, sirf `agentNumber` ka format check hota hai. Phir `accounts/actions.ts:50` aur `tax-rules/actions.ts:53` sirf `session.isTaxAgent` check karte hain, koi permission nahi. `tax-rules/service.ts:164-200` `TaxRuleVersion` update karta hai, jiska koi `firmId` hai hi nahi (`schema.prisma:1011`). Koi bhi sign-up par checkbox tick karke platform-wide depreciation thresholds badal sakta hai. Rule: "Check the permission, never the role."

### MED

- **T4.** `core/mail.ts:27-32` — ConsoleTransport recipient email + poora body `console.info` karta hai: OTP codes, reset links, aur `auth/service.ts:558-563` ka plaintext temp password. `RESEND_API_KEY` na ho toh production mein bhi silently console par fallback.
- **T5.** `app/feed/[token]/page.tsx:31-40` — `?answer=approve` GET par CDR consent record hota hai. Email link prefetcher ya scanner auto-approve kar dega. Token guessing par rate limit nahi (`feeds.ts:648` sirf shape check).
- **T6.** `app/(app)/accounts/export/route.ts:12` — sirf `requireSession()`, koi permission nahi. Sibling `journals/export/route.ts:12` `report:export` check karta hai.
- **T7.** `CLIENT` role exist nahi karta — skill 7 roles list karti hai, `schema.prisma:88-95` aur `core/permissions.ts` mein 6 hain. ✔
- **T8.** Permission drift — skill ke `client:delete`, `transaction:delete`, `bas:approve` code mein nahi. Code ke `client:read`, `transaction:read`, `journal:create`, `report:read`, `bas:prepare`, `billing:read` declared hain lekin **kahin check nahi hote**. VIEWER bhi BAS screen dekh sakta hai.
- **T9.** Malware scan kahin nahi (`ingest/schema.ts`, `clients/logo.ts` sirf sniff + size cap).
- **T10.** `billing/stripe.ts:110-113` — `WebhookEvent` row process se **pehle** ban jaata hai aur baad mein `processed` mark nahi hota. `applyPlan` crash ho toh Stripe ki har retry "already processed" par ruk jaayegi. Fiskil wala sahi hai (`feed-webhook.ts` `markProcessed`).

### LOW

- `jobs/service.ts:82` `eventsSince` unscoped `findUnique` (route pre-check se safe). `jobs/queue.ts:112` same, worker-internal.

### IDOR suite gaps (`server/tests/idor/services.idor.test.ts`)

Import hi nahi: `ingest`, `firms`, `billing`, `support`, `tax-rules`, `reconcile/engine`. Uncovered exports: `accounts.verifyAccountTreatment` (T2), `reconcile.restoreTransaction`, `reports.getGeneralLedger/getTransactionsReport/getTrialBalance`, `assets.getDepreciationSchedule`, `loans.loanBalances`, `clients.updateClient`, poora `feeds.ts`, poora `firms`, `jobs.eventsSince`, `auth.inviteUser/changeRole`. Aath `route.ts` files par koi route-level IDOR test nahi.

### Compliant

firmId sirf session se; har repository `update` se pehle firm-scoped find; 404 not 403 har jagah; saare actions (T3 ke alawa) `requireSession` + `can()`; Fiskil webhook HMAC + PK replay guard + server-side tenant resolve; AI prompt mein sirf ref/date/amount/description/feed category; uploads magic-byte sniff + server keys + path guard + SVG reject.

---

## 2. double-entry-ledger

### HIGH

**L1. Transactions report ledger bypass karta hai**
`app/(app)/clients/[id]/reports/transactions/page.tsx:35-37` — server component `BankTransaction.amountCents` sum karke Money in / Money out / Net / Total GST dikhata hai. PENDING aur CLASSIFIED (never-posted) rows bhi included. Yeh figures P&L aur BAS se match nahi karenge.

**L2. `getTransactionsReport` bhi**
`server/src/modules/reports/service.ts:123-159` — skill jise "six reports over JournalLine" mein ginti hai, woh `reconcile.listTransactions` call karke raw `amountCents/gstCents/netCents/balanceCents` deta hai.

**L3. GST sign dono stores mein ulta** ✔
`reconcile/service.ts:144` — `gstFromGross(t.amountCents)` **signed** amount par, toh expense ka `BankTransaction.gstCents = -1000`. `ledger/service.ts:259-260` — `naturalGross()` **magnitude** par, toh usi expense ki `JournalLine.gstCents = +1000`. Transactions report ka "Total GST" negative, BAS 1B positive. Do arithmetic, do jawab.

**L4. Teesra enforcement leg missing**
`ledger-reports.test.ts:49,68-70` sirf hand-written fixture par pure function test karta hai. Koi DB-backed test nahi jo `postJournal` se post karke trial balance padhe. `server/tests/` mein sirf IDOR suite hai.

### MED

- **L5.** `reports/service.ts:201-228` `getTpar` — service mein inline `debit − credit` aur `reduce`. File ka apna header comment ("Nothing in this file adds two amounts together") ab jhoot hai.
- **L6.** `reconcile/service.ts:374-380` `reopenTransaction` — `journalEntryId: null` set karta hai. Reversal sahi post hota hai lekin journal → bank transaction chain sirf audit row se recoverable.
- **L7.** `ledger/service.ts:345-400` `reverseJournal` — linked `BankTransaction` ko touch nahi karta. `source: "BANK"` journal detail page se reverse ho sakta hai (`journals/[entryId]/page.tsx:27`), transaction REVIEWED hi rehta hai, reversed entry ko point karta hua.
- **L8.** `ledger/README.md:20-21` stale — CHECK constraints aur bank posting "not yet built" kehta hai, dono live hain.

### LOW

- `journals/[entryId]/page.tsx:25-26` aur `journal-modal.tsx:130-131,282` `journalTotals()/checkJournalShape()` view mein re-implement (import karo).
- `BankTransaction.journalEntry onDelete: SetNull` — latent, koi delete path nahi.
- `clients/repository.ts:165,208` `partner/beneficiary.deleteMany` hard delete (ledger ke bahar).

### Compliant

Zero `parseFloat` on money, zero `Float/Decimal` money fields; `/100` sirf `shared/format.ts`, `<Money>`, exports, prompt par. Sign convention consistent. `validate.ts` + `constraints.sql` + migration. Zero `journalEntry/journalLine.update/delete` anywhere. Opening balance real 1-July journal. TB zero aur A=L+E assertions UI mein (`trial-balance/page.tsx:46`, `balance-sheet/page.tsx:80`). Baaki 6 reports sirf `JournalLine` se.

---

## 3. au-tax-rules

### HIGH

**A1. Stored tax calculations rule version record nahi karte**
`schema.prisma:620-647` (JournalLine), `:702-730` (Asset) — koi `taxRuleVersionId` nahi. Baad mein earlier `effectiveFrom` ke saath rule verify ho toh historical depreciation silently badal jaata hai. Skill: "Every stored tax calculation records which rule version produced it."

**A2. BAS persist nahi hota** ✔
Koi BAS model nahi. `reports/service.ts:90-110` `getSimpleBas` har page load par recompute. `calculated_value / adjustment_value / final_value` teen columns ka koi jagah nahi. Lodged figure ki history nahi, adjustment ka audit trail nahi.

**A3. Input-taxed G1/G11 se bahar**
`au/gst.ts:113-126` `BAS_MAP` mein `INPUT_TAXED: []`. Input-taxed sales (residential rent 205, interest income 202) G1 mein nahi; input-taxed purchases (bank fees 404, interest 400) G11 mein nahi. G1/G11 har client ke liye understated. Comment mein `REQUIRES_VERIFICATION` hai jo mitigate karta hai, lekin aaj galat ship hota hai.

### MED

- **A4.** `assets/depreciation.ts:92` — `(PRIME_COST ? 12 : 24) / effectiveLifeMonths`: 100%/life aur 200%/life bare literals. `DEPRECIATION_METHODS` rule catalogue mein hai lekin `declineFor` kabhi `currentRule` call nahi karta. Versioned abstraction decorative.
- **A5.** `au/gst.ts:5` `GST_RATE = 0.1` aur `gst-math.ts:14` `/ 11` hardcoded, koi `TaxRuleVersion` code nahi. Skill: versioning "applies to GST rates".
- **A6.** `reports/service.ts:195` `getTpar` — `[CODE_SUBCONTRACTORS]` (320) hardcoded, koi `currentRule`, koi verification badge. W1/W2 ko rule mila, TPAR ko nahi.
- **A7.** `au/coa.ts:93` — `290 Refunds` EXPENSE + `GST_ON_EXPENSES`. Customer refund G11/1B mein jaayega, G1/1A kam hone ki jagah. Unflagged.

### LOW

- `coa.ts:66` Rebates & Grants BAS_EXCLUDED unflagged (grants tied to supply taxable hote hain).
- `coa.ts:122` Workers Comp GST_ON_EXPENSES unflagged (state-wise alag).
- `coa.ts:119` Travel-International GST_FREE_EXPENSES (overseas accommodation out of scope, GST-free nahi).
- `aggregate.ts:197` W1 = debit − credit, net-wages posting par understated, koi warning nahi.
- `gst.ts:72` `grossFromNet` × 1.1 kuch cent values par `/11` se round-trip nahi karta.

### Compliant

`/11` sirf `gst-math.ts:14` mein, poore repo mein zero inline `* 0.1` / `/ 1.1`. Client preview `gstComponentCents` import karta hai. Rounding `Math.abs` pehle, sign baad mein: sahi half-away-from-zero. 9 treatments = skill ke 4 ka documented superset. Classic CoA rules sab sahi (bank fees, interest, wages, rates, licences, loan principal, transfers, drawings, depreciation, super). AI output schema mein koi amount field nahi. FY sirf `fy.ts` se, half-open UTC. `tax-rules/service.ts` kabhi in-place update nahi.

---

## 4. ai-classification

### HIGH

**AI1. `identifySubcontractor` provider mein nahi** ✔
`ai/types.ts:120-124` — interface mein sirf `classifyTransactions`. Skill dono maangti hai. Phase plan M9.2 unimplemented; subcontractor sirf manual assign hota hai.

**AI2. Golden set CI mein nahi chalta** ✔
CI config exist nahi karta. `ai:golden` sirf haath se. Prompt/model/rules change bina regression ke ship ho sakta hai.

**AI3. OpenAI provider refusal ko regex se detect karta hai**
`ai/openai-provider.ts:59,83` — Responses API refusal ko content part ke roop mein deta hai; yeh provider sirf `output_parsed` dekhta hai aur error message par `/refus/i` regex. Skill: "never regex an LLM response."

### MED

- **AI4.** `reconcile/engine.ts:211-222` lineage mein **`inputHash` nahi, raw `output` nahi** (gate par reject hua proposal reproduce nahi ho sakta), **decision `timestamp` nahi** (sirf row `createdAt` = import time; re-run overwrite karta hai bina naye timestamp ke).
- **AI5.** Cost tracking zero. `cacheReadTokens` record hota hai (`anthropic-provider.ts:99`) lekin koi use nahi padhta. Cache miss par koi alert nahi. Cost per 1,000 transactions per firm kahin nahi.
- **AI6.** `engine.ts:196` + `ai/prompt.ts:91` — raw unmasked `description` provider ko jaata hai. AU bank narrations mein payer ka naam, card fragments, PayID email/phone hote hain. Koi masking (`grep mask|redact` → kuch nahi). Baaki payload minimal aur sahi hai.
- **AI7.** `anthropic-provider.ts:86-88` `effort` set nahi (default high). Comment se justified. Documented deviation.

### LOW

- `anthropic-provider.ts:74-90` `messages.stream().finalMessage()` where skill `messages.parse()` kehti hai; functionally same, comment nahi.
- `mock-provider.ts:72` `promptVersion: "mock-v1"` kisi file se linked nahi.
- `engine.ts:250` safety-critical predicate mein `&&` / `||` unparenthesised.

### Validation gate status (engine.ts:240-272)

schema ✔ · account exists ✔ · belongs to firm ✔ (via `listPostableAccounts(firmId, clientId)`) · active ✔ · treatment fits ✔ · GST recomputed ✔ · **journal balances — engine mein nahi**, accept time par structurally guaranteed (do mirrored lines). Defensible, lekin engine mein note nahi. · confidence + risk ✔

### Compliant

Provider failure → poora batch Unknown + needsReview (`engine.ts:224-230`), koi silent skip nahi. `stop_reason === "refusal"` content se pehle (`anthropic-provider.ts:106`), null `parsed_output` (`:118`), transport error (`:133`), teenon tested. SDK sirf `server/src/ai/*` mein. MockProvider real. `claude-opus-5` default. Prompts disk par v1/v2. Chart of accounts `cache_control` ke saath system mein. Batch 40 env-tunable. Engine sirf `CLASSIFIED` likhta hai, ledger tak koi raasta nahi bina `acceptTransactions` ke.

---

## 5. reconciliation-engine

### HIGH

**R1. Candidate account generation stage nahi**
`engine.ts:178-184` — AI ko client ka **poora postable chart** jaata hai, narrowed nahi. Skill pipeline mein "candidate account generation" alag stage hai (cost, latency, hallucination surface).

**R2. Loan repayment split nahi hota**
`rules.ts:102-109` — poora amount `840` par `needsReview: true` ke saath. `loans/amortisation.ts` split nikaal sakta hai lekin engine ya `recodeTransaction` use kabhi call nahi karte. Reviewer ke paas split tool bhi nahi (R11). Skill: "never expense the whole payment"; yahan poora capitalise hota hai, liability misstated.

**R3. Historical inconsistency risk factor nahi**
`risk.ts:23-33` — amount · novelty · tax impact · account type implemented; **same merchant pehle alag account par coded** detect nahi hota. `repository.ts:166-173` `reviewedDescriptions` sirf Set of strings deta hai, divergent coding nahi.

### MED

- **R4.** Merchant/entity resolution distinct stage nahi — `normaliseDescription` string scrub hai. Fiskil merchant field engine consume nahi karta (`engine.ts:199-200` sirf category).
- **R5.** `risk.ts:31` `config.highRiskCents / 10` — novelty threshold ka hardcoded divisor, config ke bahar ek hi literal.
- **R6.** `rules.ts:95-101` ATO → `830 Income Tax Payable` default. Treatment sahi, account judgement call jo bina padhe accept ho toh mis-post.
- **R7.** Skill `877` kehti hai, code `977` (sahi). Skill stale. ✔
- **R8.** Skill `999 Unknown` kehti hai, code `0` (sahi, prompt bhi 0). Skill stale. ✔
- **R9.** "Rules + memory ≥ 60%" — `engine.ts:316-332` counts audit mein likhta hai lekin ratio kabhi compute/compare/warn nahi hota.

### LOW

- `repository.ts:278-280` `deleteMemoryRule` hard delete (audit mein full before hai; skill "deletable" maangti hai, acceptable).
- Floor `0.75` vs skill band `0.80` — practically harmless, `config.ts:11` mein deviation documented nahi.
- Stale memory rule silently fall-through (`engine.ts:132-148`), koi counter nahi.
- `evidenceCount` increment hota hai (`service.ts:158`) lekin `memory.ts:37-40` scoring mein use nahi; memory confidence hamesha 1. Dead field.

### Gap vs phase plan (skill nahi)

**R11. Split transactions bilkul nahi.** M5.4 `sum(splits) == original` — koi model, koi schema field, koi UI, koi invariant. R2 ka direct cause.

### Compliant

Stage order sahi. Memory CLIENT > FIRM scoring. Memory re-validated (active, type, treatment) before apply. Teen remember choices verbatim (`recode-modal.tsx:168-170`). Memory visible/editable/deletable (`memory-view.tsx`). Abstention first-class, prompt v2 paanchon ambiguous cases naam leta hai. Thresholds config se (R5 ke alawa). Routing table match. False auto-approval `ai-golden.ts` ka headline metric. Bulk accept per-record. Sibling recode safe.

---

## 6. prisma-schema-conventions

### HIGH

**P1. Migration drift — poora Fiskil feature migrate nahi hua** ✔
7 migrations mein 28 tables, schema mein 29 models. **`FeedSyncRun` kisi migration mein nahi.** Columns bhi nahi: `Client.feedEndUserId`, `Firm.howHeard`, `User.professionalBody`, `BankAccount.feedConnectionId/feedProductCategory/feedLastSyncedAt`, `BankTransaction.externalId/postedAt/executionAt/feedCategory/feedSubcategory/feedCategoryConfidence/feedMerchantCode/feedRaw` + unique, `BankFeedConnection.arrangementId/authSessionId/.../revokedAt` + unique, `BankFeedRequest.connectionId`. `migrate deploy` staging par feed sync chala hi nahi sakta. Git log ke 4 migrations (trust, logo, asset category, loan type) sahi hain.

**P2. Optimistic locking kahin nahi** ✔
Koi `version Int @default(0)` column nahi, koi read-compare-write nahi. `BankTransaction`, `Client`, `Account`, `MemoryRule` sab last-write-wins. Do accountants ek hi screen par: ek ki correction silently kho jaayegi.

### MED

- **P3.** Multi-record writes bina `$transaction`: `banking/feeds.ts:385+397` (`completeFeedConnection`), `:435+468` (`refreshConnections`, audit alag tx mein), `:519+526` (`revokeFeedConnection`), `:733`, `:262`; `feed-sync.ts:101,139,271,303,430,441` sab tx ke bahar, sirf `:384` transactional.
- **P4.** `onDelete: Cascade` accounting parents par: `JournalEntry.client`, `JournalLine.entry`, `BankTransaction.bankAccount`, `StatementImport.bankAccount`, **`AuditLog.firm`**, `Asset/Loan/Subcontractor.client`, `Account.firm/client`, `MemoryRule.account`. Ek Client/Firm delete poora ledger aur uska audit trail uda dega. Code mein delete path nahi, DB allow karta hai.
- **P5.** `schema.prisma:238` `incomeTaxRate Int? @default(25) // percent` — unit sirf comment mein. `incomeTaxRatePercent` rename.
- **P6.** `FeedSyncRun` mein `createdAt` nahi (`startedAt` use). `RateLimit` mein id/createdAt/firmId path nahi (infra counter, exemption undocumented).
- **P7.** Review screen predicate (`reconcile/repository.ts:150-160`: `excludedAt null + status + needsReview` per client) ke liye index nahi. Suggest `@@index([bankAccountId, status, needsReview])` aur `@@index([importId])`.

### LOW

- `FeedSyncRun.status/trigger`, `BankTransaction.risk` stringly-typed, enum hona chahiye.
- `Asset.costCents`, `Loan.principalCents/repaymentCents` par CHECK ≥ 0 nahi; partner shares = 10000 sirf service mein.
- `MemoryRule` lookup ke liye `[firmId, clientId, matchType]` index.

### Compliant

Saare money fields `Int` + `Cents` suffix; sirf `Float` = `confidence`. Basis points clearly named. Naming 100% clean (models, fields, enums, FKs, booleans). Unique constraints sab present. `onDelete: Restrict` on `JournalLine.account` aur `JournalEntry.reverses`. CHECKs migration mein. Deletion policy honoured (sirf rateLimit, session, partner/beneficiary replace, memoryRule delete). `new PrismaClient` sirf `core/db.ts` + seed. `prisma.config.ts` direct URL sahi.

---

## 7. jobs-and-audit

### HIGH

**J1. Reconciliation request mein inline chalta hai**
`reconcile/actions.ts:19-29` `runReconciliation` → `runEngine` seedha server action mein (AI calls + 120s tx timeout `engine.ts:334`). `review-view.tsx:162` ka "Reconcile" button. `/reconcile` page sahi enqueue karta hai; yeh doosra raasta bypass.

**J2. Sibling re-run inline**
`reconcile/service.ts:205-227` — recode ke baad `runEngine(siblingIds)` server action ke andar. Common description par unbounded AI reclassification ek request mein.

**J3. Usage/metering model exist nahi** ✔
`schema.prisma` mein `Usage` nahi. `billing/service.ts:54 planAllowance` cap deta hai, kuch count nahi hota. Append-only usage records with idempotency keys absent.

**J4. Idempotency test zero**
Koi test job ko do baar chala kar row count assert nahi karta. Skill: "make this a standing test."

**J5. Client mutations bina audit**
`clients/service.ts:176 createClient, :192 updateClient, :217 setClientArchived, :235 addClientNote, :369 setClientLogo, :383 removeClientLogo` — koi `recordAudit` nahi. `CLIENT_UPDATED` `AuditAction` union mein hai hi nahi. ABN, entity type, GST registration bina trace ke badal sakte hain.

**J6. Bank account create/update bina audit**
`banking/service.ts:53 createAccount, :82 updateAccount` — `$transaction` hai, audit nahi. Cash at Bank promote/demote silently balance sheet badal deta hai.

**J7. Webhook path par feed revoke/connect bina audit**
`banking/feed-webhook.ts:140-146` (`consent.revoked`), `:183-242 upsertConnection` — koi audit. Manual path (`feeds.ts:531`) audited hai; bank-initiated disconnect ka koi record nahi.

**J8. Stuck RUNNING jobs**
`jobs/queue.ts:112-114` `runJob` RUNNING par early return, lekin process mar jaaye toh RUNNING kabhi clear nahi hota. Na DEAD, na retry, `retryJob:168` sirf DEAD/FAILED leta hai. Koi heartbeat/reaper.

### MED

- **J9.** Report generation aur saare exports (Xero/MYOB/CSV) inline; `getTransactionsReport` 10,000 rows in-process. Koi `GENERATE_REPORT` job type.
- **J10.** `ingest/actions.ts:69` — `idempotencyKey: reconcile:${clientId}:${Date.now()}` unique per click; double-click = do concurrent engine runs. `banking/actions.ts:150` minute-bucket sahi karta hai.
- **J11.** `billing/stripe.ts:110-112` replay guard `findUnique` then `create` — race, constraint nahi. Fiskil PK-throw sahi hai.
- **J12.** `reports/service.ts:90/:244` — `BAS_GENERATED` union mein nahi, koi BAS view/export audited nahi.
- **J13.** `ingest/service.ts:67-77` — import create/update alag writes, phir `$transaction` sirf audit wrap karta hai. Audit change se alag tx mein.
- **J14.** `feed-sync.ts:384-417` — `BANK_FEED_SYNCED` audit tx mein, lekin actual transaction writes (`:267-277`) pehle `db` par bahar.
- **J15.** `AuditLog` (`schema.prisma:829-847`) mein `ip` aur `userAgent` nahi, kabhi capture nahi hote (signIn ke paas `ip` hai `auth/service.ts:157`).
- **J16.** In-process `setTimeout` dispatch default; 60s backoff serverless boundary survive nahi karega.
- **J17.** Admin dashboard nahi (M7.8); DEAD jobs sirf per-firm Activity Panel mein.
- **J18.** Failed rows persist + count hote hain (`upload-statement-modal.tsx:110`) lekin **download aur retry failed rows** dono absent.
- **J19.** Tax rule version FK stored calculations par nahi; `getSimpleBas` read-time `currentRule` resolve karta hai (A1 se overlap).

### LOW

- `ingest/service.ts:130-133` zero-row file throw → 3 retry → DEAD, terminal validation failure hona chahiye.
- `JournalLine` par `bankTransactionId` nahi, sirf entry-level link (multi-transaction entry par tootega).
- `reconcile/repository.ts:64-72` explicit ids par CLASSIFIED overwrite (REVIEWED safe).
- `support/service.ts:22` no audit.

### Compliant

Job model skill ke har field ke saath + `idempotencyKey @unique`; STAGES skill list se exactly match; `report()` JobEvent + Job ek tx mein; SSE sirf rows se; backoff [2s,10s,60s] + DEAD + Retry button; import fingerprint unique; feed `[bankAccountId, externalId]` unique + `skipDuplicates`; Fiskil webhook PK replay + async enqueue; posted rows sync overwrite nahi karta; bulk accept per-record; **saare 54 `recordAudit` call sites `tx` pass karte hain, zero `recordAudit(db)`**; auditLog par koi update/delete nahi; AI lineage `aiMeta` + `RECONCILIATION_RUN` audit; lineage FKs (`importId`, `journalEntryId`, `reversesId/reversedBy`, `storagePath`) present.

---

## Priority fix list

Severity × blast radius ke hisaab se, upar se neeche:

1. **T2 + T3** — `verifyAccountTreatment` ko sirf firm-owned accounts tak limit karo; `isTaxAgent` ko sign-up checkbox se hata kar OWNER/ADMIN-granted flag ya alag permission (`tax:verify`) banao; `TaxRuleVersion` mutation ko usi permission ke peeche rakho.
2. **T1** — `recodeTransaction` mein `subcontractorId` ko `subcontractors.listOptions(firmId, clientId)` se validate karo (ledger jaise).
3. **P1** — Fiskil feature ki migration generate karo (`prisma migrate dev --create-only`), warna staging deploy hi nahi hoga.
4. **L1 + L2 + L3** — Transactions report ko `JournalLine` par le jao; `BankTransaction.gstCents` ka sign ledger se align karo (ya document karo ki bank-side signed hai aur report use nahi karega).
5. **CI** — `.github/workflows/ci.yml`: typecheck + `npm test` + `test:idor` (Neon branch) + `ai:golden` (mock ya recorded).
6. **J5 + J6 + J7** — client, bank account, webhook-path feed mutations par audit rows.
7. **J1 + J2 + J10** — review-screen reconcile aur sibling re-run ko `RECONCILE_CLIENT` job mein bhejo; idempotency key stable banao.
8. **P2** — `version Int` on `BankTransaction`, `Client`, `Account`, `MemoryRule` + updateMany with version check.
9. **A2 + A1** — BAS snapshot model (`calculatedCents/adjustmentCents/finalCents` + `taxRuleVersionId`); JournalLine/Asset par rule version link.
10. **R2 + R11** — split transaction model + loan repayment split via amortisation.
11. **T4** — ConsoleTransport se body log hatao (sirf "sent to <hash>" log karo), production mein mailer absent ho toh fail loudly.
12. **T5** — feed consent ko POST banao.
13. **J8** — stale RUNNING reaper (startedAt + N min → FAILED, retryable).
14. **Skills fix** — reconciliation-engine mein `977`/`0`; tenant-security mein permission list aur role list ko code se sync karo (ya code ko skill se, lekin decide karo).
15. Baaki MED/LOW upar ke sections se, module-wise jab us module ko chhuo.


---

## Remediation status (16 September 2026, same day)

Har finding ka kya hua. "Fixed" matlab code + test; "Documented" matlab deliberate deviation ab
comment/doc mein likha hai; "Open" matlab abhi baaki.

| ID | Finding | Status | Kahan |
|---|---|---|---|
| T1 | Recode mein subcontractor unchecked | Fixed | `reconcile/service.ts` resolves subcontractor AND loan through the client; IDOR test |
| T2 | System account par cross-tenant write | Fixed | `AccountVerification` per firm; shared row never written; IDOR test proves B still sees the flag |
| T3 | Self-declared tax agent | Fixed | `TaxRuleVersion.firmId`; `canVerifyTax` = `tax:verify` + registration; team page records registration; IDOR test |
| T4 | Mail body logged | Fixed | Console transport withholds body in production, masks recipient |
| T5 | Consent on GET | Fixed | `/feed/[token]` posts through a server action; token lookups rate-limited per IP |
| T6 | Accounts export without permission | Fixed | `report:export` |
| T7 | CLIENT role | Documented | Skill text: no CLIENT role by design |
| T8 | Dead permissions | Fixed | `report:read` (reports layout), `bas:prepare` (BAS page), `client:read` (client layout), `transaction:read` (review page), `bas:approve`, `tax:verify`; skill list synced |
| T9 | Malware scan | Open | Needs an external scanner; noted in CLAUDE.md |
| T10 / J11 | Stripe replay guard | Fixed | PK-based insert, `processedAt` after processing, error recorded |
| L1 / L2 | Transactions report bypasses ledger | Fixed | `transactionsReport()` over journal lines; page rewritten; tests |
| L3 | GST sign mismatch | Documented | Report no longer reads `BankTransaction.gstCents`; the bank row keeps the signed convention, the ledger the natural-side one |
| L4 | No DB-backed ledger test | Fixed | `tests/db/ledger.db.test.ts`: trial balance zero after post, accept, reverse |
| L5 | TPAR arithmetic in service | Fixed | `tpar()` in `aggregate.ts` |
| L6 | Reopen dropped `journalEntryId` | Fixed | Pointer kept; `JournalLine.bankTransactionId` carries full history |
| L7 | Reversing a BANK entry from the journal page | Fixed | Refused with guidance to reopen |
| L8 | Stale ledger README | Fixed | |
| A1 | Rule versions not linked to stored calculations | Fixed | `JournalEntry.rulesVersion`; `BasStatement.taxRuleVersions`; depreciation schedule returns `ruleVersions` |
| A2 | BAS not persisted | Fixed | `BasStatement` + lines (calculated / adjustment / final, DB CHECK); prepare / adjust / finalise; audits |
| A3 | Input-taxed out of G1/G11 | Fixed (gated) | `INPUT_TAXED_BAS_LABELS` rule; applied when verified; BAS shows omitted count until then |
| A4 | Depreciation rates hardcoded | Fixed (gated) | `DEPRECIATION_METHODS` parsed and applied; statutory fallback flagged on the report |
| A5 | GST rate unversioned | Documented | `GST_RATE_PERCENT` catalogue entry; arithmetic stays one constant; stamped on every entry |
| A6 | TPAR accounts hardcoded | Fixed | `TPAR_ACCOUNTS` rule + badge |
| A7 | 290 Refunds on the wrong side | Flagged | The practice supplied 290 as an expense (chart of 16 Sep 2026); it is kept as given and flagged REQUIRES_VERIFICATION with the customer-refund note, so the advisor decides. Migration 9 predates the chart replacement; `db:sync-accounts` applies the chart over it |
| A8-10 | Unflagged treatments | Fixed | On the replaced chart: 203 Rebates, 332 Workcover, 290 Refunds flagged with notes (493/510 no longer exist) |
| AI1 | `identifySubcontractors` missing | Fixed | All three providers; `proposeSubcontractorLinks`; confirm through recode; UI on the register page |
| AI2 | No CI | Fixed | `.github/workflows/ci.yml`: typecheck, unit, migrations from scratch, IDOR, DB, golden |
| AI3 | OpenAI refusal by regex | Fixed | Typed refusal content part |
| AI4 | Lineage gaps | Fixed | `inputHash`, raw `proposal`, `decidedAt` in `aiMeta` |
| AI5 | No cost tracking | Fixed | Token totals + cache warning + pre-AI ratio in `ReconcileStats` and the run's audit row |
| AI6 | Unmasked narrations | Fixed | `maskDescription()`: cards, BSB/account, emails, phones, long references |
| AI7 / LOW | `effort`, `stream()` undocumented | Documented | Comments in the provider |
| R1 | No candidate generation | Fixed | `candidateCodes` from reviewed codings, memory and rule targets; shown in the cached prefix |
| R2 | Loan repayment not split | Fixed | `loanId` on the transaction; split at acceptance from the amortisation schedule; DB test |
| R3 | Historical inconsistency | Fixed | `reviewedCodings()`; `inconsistent` risk factor |
| R4 | Merchant signal unused | Partial | ISO 18245 merchant code sent to the model; no canonical merchant entity |
| R5 | Novelty divisor literal | Fixed | `RECONCILE_NOVELTY_RISK_CENTS` |
| R7 / R8 | Skill stale (877, 999) | Fixed | Skill now names the `CODE_*` constants, not numbers — the chart was replaced on 16 Sep 2026 and every code moved |
| R9 | Pre-AI ratio unmeasured | Fixed | `preAiRatio` + warning below `RECONCILE_PRE_AI_TARGET` |
| R-LOW | evidenceCount unused; floor undocumented; stale memory silent | Fixed | Scoring tiebreak; config comment; run warning |
| R11 | Split transactions (phase plan) | Open | Only the loan split exists |
| P1 | Migration drift | Fixed | Migration 7 (bank feeds) generated from the real diff; init migration's stray line removed |
| P2 | No optimistic locking | Fixed | `version` on BankTransaction, Client, Account, MemoryRule, BasStatement; enforced in every edit |
| P3 | Multi-writes outside tx | Fixed (feeds), Documented (feed-sync pages) | `feeds.ts` paths wrapped with audit inside; sync page writes are per-page inserts by design |
| P4 | Cascade on accounting parents | Fixed | RESTRICT; `purge-demo` and test teardown delete leaves first |
| P5 | `incomeTaxRate` unit | Fixed | Renamed `incomeTaxRatePercent` (column rename, no data loss) |
| P6 / LOW | createdAt, enums | Fixed | `FeedSyncRun.createdAt`; `RiskLevel`, `FeedSyncStatus`, `FeedSyncTrigger` enums |
| P7 | Review-screen index | Fixed | `[bankAccountId, status, needsReview]`, `[importId]`, `[firmId, clientId, matchType]` |
| J1 / J2 | Reconcile inline | Fixed | Review button and sibling re-run both enqueue `RECONCILE_CLIENT` (subset ids in the job) |
| J3 | No usage model | Fixed | `UsageEvent`, written at acceptance, idempotent; meters read it |
| J4 | No idempotency test | Fixed | `tests/db/import-idempotency.db.test.ts` |
| J5 / J6 / J7 | Missing audits | Fixed | Client, bank account, webhook consent paths |
| J8 | Stuck RUNNING jobs | Fixed | `reapStaleJobs()` |
| J9 | Reports inline | Open | Noted in CLAUDE.md |
| J10 | Per-click idempotency key | Fixed | Minute bucket |
| J12 | BAS not audited | Fixed | `BAS_GENERATED` / `BAS_ADJUSTED` / `BAS_FINALISED` |
| J13 | Import audit outside tx | Fixed | Row and audit in one transaction |
| J15 | ip / userAgent | Fixed | Captured from the request when there is one |
| J16 / J17 | In-process dispatch; admin dashboard | Open | |
| J18 | Failed rows download | Fixed | `/clients/[id]/banks/imports/[importId]/failed-rows` |
| J-LOW | Zero-row import retried | Fixed | `TerminalJobError` → DEAD with `VALIDATION` |
| CI | No CI | Fixed | See AI2 |

**Ek aur bug jo audit mein nahi tha:** `20260908000000_init/migration.sql` ki pehli line "Loaded Prisma
config from prisma.config.ts." thi (CLI output jo file mein paste ho gaya). Isse `migrate deploy` pehli
migration par hi fail hota, matlab staging kabhi deploy nahi ho sakta tha. Hataya.

**Test status after remediation:** unit 25 files / 204 tests, IDOR 15 tests, DB 4 tests, all passing
against Neon. Migrations 1 to 9 deploy from scratch on a shadow database with an empty residual diff.

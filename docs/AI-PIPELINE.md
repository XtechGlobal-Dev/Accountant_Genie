# AI-assisted coding pipeline — audit and implementation plan

Written 17 September 2026 on the `fix/csv-statement-preamble` branch, before any code in this
change was written. Part 1 records what the codebase already does, file by file. Part 2 is the
plan that was implemented on top of it. Part 3 records the decisions that departed from the
brief and why.

---

## Part 1 — What exists (Phase 1 audit)

| # | Area | Where | Finding |
|---|---|---|---|
| 1 | Chart of accounts | `server/src/au/coa.ts` | ~90 system accounts seeded per the practice's sheet of 16 Sep 2026. Named constants (`CODE_CASH_AT_BANK` 701, `CODE_GST_PAYABLE` 810, `CODE_WAGES` 600 …) are what code relies on. Custom accounts live above 1000 (`shared/account-rules.ts`). |
| 2 | Account model | `schema.prisma` `Account` | `firmId` null = system, `clientId` null = every client of the firm. `type`, `gstTreatment` (the account's default), `isActive`, `requiresVerification` + `taxNote`, `version`. `@@unique([code, firmId, clientId])`. |
| 3 | Code generation | `modules/accounts/service.ts` `createCustomAccount` | None. A person types the code; `findCodeClash` refuses a firm-wide duplicate. No name-similarity check. |
| 4 | Account types | `AccountType` enum | ASSET, LIABILITY, EQUITY, INCOME, COGS, EXPENSE, UNKNOWN (sentinel only). `TREATMENTS_BY_TYPE` says which tax codes each may carry. |
| 5 | Tax codes | `GstTreatment` enum, `au/gst.ts` | Nine codes with the BAS direction built in. `BAS_MAP` maps each to G1/G10/G11/1A/1B. |
| 6 | GST arithmetic | `au/gst.ts`, `shared/gst-math.ts` | `gross / 11`, half away from zero, sign preserved. Only deterministic code calls it. |
| 7 | Import | `modules/ingest/service.ts`, `parse.ts`, `parse-pdf.ts` | Upload → store original → job: parse → dedup → insert → `runEngine` → stats in the COMPLETED job event. |
| 8 | Transaction model | `BankTransaction` | `normalised`, `fingerprint`, `status PENDING→CLASSIFIED→REVIEWED`, `source RULE/MEMORY/AI/MANUAL`, `confidence`, `reasoning`, `needsReview`, `risk`, `aiMeta` (lineage), `journalEntryId`, `version`. |
| 9 | AI classification | `ai/types.ts`, `ai/prompt.ts`, `ai/anthropic-provider.ts`, `ai/mock-provider.ts`, `prompts/transaction-classification/v3.md` | Zod structured output; refusal and null `parsed_output` both route to review; chart in the cached system prefix; narrations masked; input hash stored. Result = `{ref, accountCode, gstTreatment, confidence, reason, needsReview}`. **No way to propose an account.** |
| 10 | Vendor / customer models | — | None. The only merchant identity is `BankTransaction.normalised`. Subcontractors have a register for TPAR. |
| 11 | Rules / memory | `reconcile/rules.ts`, `reconcile/memory.ts`, `MemoryRule` | Eight deterministic rules (transfer, fees, interest, wages, super, ATO, loan). Memory rules are client- or firm-scoped, EXACT or CONTAINS, scored client > exact > longer > evidence. **Learned only by Recode with "remember"; Accept teaches nothing.** |
| 12 | Journal model | `JournalEntry` | Immutable; `reversesId @unique`; `rulesVersion`; `source BANK/MANUAL/OPENING`. |
| 13 | Journal line | `JournalLine` | Gross `debitCents`/`creditCents`, **`gstCents` snapshot on the line**, `gstTreatment` snapshot, `bankTransactionId` lineage. CHECK constraints in `20260908000001_constraints`. |
| 14 | General ledger | `reports/ledger-reports.ts` | Reads journal lines only. |
| 15 | P&L | `reports/aggregate.ts` `profitAndLoss` | Per account: gross less the line's `gstCents`. **Already net of GST.** |
| 16 | Balance sheet | `ledger-reports.ts` `balanceSheet` | Assets net of expense GST; a derived `gstControlCents` from the line snapshots. 720 GST Receivable / 810 GST Payable exist in the chart but nothing posts to them: the control balance is derived, not posted. |
| 17 | BAS | `aggregate.ts` `simpleBas` | `gstCents` routed by the line's snapshotted treatment; W1/W2 from verified rules; every figure lists its contributing lines (lineage). Refuses while anything is UNALLOCATED. |
| 18 | Duplicate detection | `ingest/fingerprint.ts` | `sha256(bankAccount, date, amount, normalised)` + `@@unique([bankAccountId, fingerprint])`; feed rows also `@@unique([bankAccountId, externalId])`. |
| 19 | Review / approval | `reconcile/service.ts` `acceptTransactions`, `review-view.tsx` | Accept claims the row by `version`, posts through `postBankTransactionInTx`, links `journalEntryId`, meters usage idempotently, audits. Reopen reverses. The screen shows `reasoning`, source, risk and Ready/Review status. |
| 20 | Audit | `core/audit.ts` `recordAudit(tx, …)` | Append-only, written on the caller's transaction client. Actions for journals, accounts, memory, transactions, imports all exist. |

### Why the 5-row import came out as it did

- All five rows were novel for the client and four were $500 or more, so `scoreRisk` marked them
  HIGH on novelty (`RECONCILE_NOVELTY_RISK_CENTS` = 50 000) and HIGH risk always routes to review,
  whatever the confidence. On a fresh client every row is novel, so nothing could ever be Ready on
  a first import.
- The AI's own `needsReview` and any confidence under 0.95 route to review as well.
- "Unknown" counts rows left UNALLOCATED: the model abstained, or the gate rejected its proposal.
  The count moved between runs because sampling parameters cannot be pinned on current models.
- Transactions do become journals — but only when a person clicks Accept. That is by design
  (professionals approve) and is unchanged.

---

## Part 2 — The plan (implemented)

Every stage in the brief maps onto something that already exists. The changes are additive.

| Brief stage | Existing | Change |
|---|---|---|
| Bank import, normaliser, duplicate check | ingest | none |
| Existing transaction match, vendor memory | `reviewedCodings`, `MemoryRule` | **Accept now teaches memory**: a client-scoped CONTAINS rule on the vendor key (`reconcile/vendor.ts`), never overwriting a rule that points elsewhere. |
| Vendor normalisation | `normalised` only | `vendorKey()` — pure, tested; collapses "ADOBE AUSTRALIA PTY LTD" / "Adobe Creative Cloud" onto `adobe`. |
| User rules, pattern matching | rules.ts, memory.ts | none (order already memory → rules → AI) |
| AI classification | v3 prompt, result schema | **v4 prompt and schema**: result gains `vendor`, `category`, `proposedAccount {name, type, gstTreatment}`. Code 0 + a proposal means "nothing in the chart fits; here is the nature of the expense". |
| Account proposal → validation → create | none | **`accounts/resolver.ts`** (pure): similarity match against the visible chart first; else the next free code in the type's custom band. **`accounts/service.ts createProposedAccountInTx`**: validates type and treatment, creates a firm-scoped account flagged `requiresVerification`, audits `ACCOUNT_CREATED` with the AI lineage. Capped per run. |
| Tax engine | au/gst.ts | none — the LLM still never computes |
| Journal engine | inline in `postBankTransactionInTx` | **`ledger/journal-engine.ts`** (pure): builds the lines from direction, allocations, treatment and bank account; runs `checkJournalShape`. Used by the posting path **and** by the engine as a dry run before a row can be Ready. |
| Double-entry validation | `checkJournalShape`, DB CHECKs | now also applied at classification time |
| Confidence engine | config + risk | Novelty risk applies to AI-tier decisions only; a rule or memory hit is the firm's own policy. The novelty default moves from $500 to $2,500 (`RECONCILE_NOVELTY_RISK_CENTS`); bands unchanged (≥0.95 + low risk → Ready). `riskFactor()` names which factor tripped, so the dialog can say why. |
| Ready / Review / Post / Ledger / Reports | accept → post → reports | none |
| Import UX | six tiles | adds "new accounts created" and the top review reasons |
| Auto learning | recode only | accept learns; recode unchanged |

### Schema

No migration. Vendor memory is `MemoryRule`; a proposed account is an `Account` row with
`firmId` set and `clientId` null; lineage goes in `aiMeta` and the audit row.

### The five test transactions

Mapped onto the real chart rather than the illustrative codes in the brief:

| Brief | Chart |
|---|---|
| 5000 Office Supplies | 450 Office Supplies |
| 5010 Software Subscriptions | 470 Subscriptions (the resolver reuses it; nothing is created) |
| 5030 Rent Expense | 480 Rent on Business Premises |
| 5040 Utilities | 360 Electricity, Gas and Water |
| 5070 Wages & Salaries | 600 Wages & Salaries (rules tier, no AI call) |

---

## Part 3 — Departures from the brief, and why

1. **Journals stay gross with the GST snapshot on the line.** The brief shows a separate
   "DR GST Receivable" line. This ledger records the same fact as `gstCents` on the expense line,
   and every report (P&L net, balance sheet control account, BAS 1A/1B) already reads it that way.
   Re-plumbing to posted control-account lines would touch every report for no change in any
   figure. The journals page shows the split (`shared/journal-presentation.ts`) exactly as the
   brief draws it: DR Office Supplies 500 · DR GST Receivable 50 · CR Bank 550.
2. **Office rent is not coded GST-free automatically.** The brief expects rent to be "GST Free
   Expenses". Commercial rent from a GST-registered landlord carries GST; whether this landlord is
   registered is not knowable from a bank line. The chart's own default for 480 is GST on
   Expenses. So the pipeline codes rent to 480 and routes it to review with the reason spelled out;
   the person sets the treatment. That is the one "Need a look" in the target numbers, and after
   that one decision the totals come out exactly as the brief lists them.
3. **A transaction that created a new account is routed to review**, however confident the model.
   Creating an account is a chart change for the whole firm and a person should see it once. The
   account itself is created immediately (and flagged for the advisor), so the next transaction
   that fits it can be Ready without any review.
4. **Accept-taught memory rules never overwrite.** If a rule for the vendor already points at a
   different account, acceptance leaves it alone and the review page keeps showing the
   disagreement as high risk.
5. **Account creation is serialised per firm.** Two runs for one firm at once (an import and a
   re-code, two clients' imports) would each find no match and each create the account under a
   different code. The resolver takes the firm's row lock (`SELECT … FOR UPDATE`) and re-checks
   the chart as it is inside the transaction before creating. The end-to-end test found this by
   accident, when the in-process job runner and a direct call overlapped.
6. **Every row coded to an account created in the run waits for a person**, not only the row that
   created it. Until someone has confirmed the account, nothing coded to it is Ready.

---

## Part 4 — Verification, 17 September 2026

| Suite | Result |
|---|---|
| `npm test` (offline unit) | 32 files, 264 tests, all passing — includes the new resolver (13), journal engine (13) and vendor key (3) tests |
| `npm run test:db` — `tests/db/pipeline.db.test.ts` | 8 tests, all passing: the five brief transactions import as 4 Ready / 1 Review / 0 Unknown; acceptance posts 5 balanced journals; trial balance difference 0; P&L expenses $6,300 net; BAS 1B $180, 1A $0, three contributing lines; re-accept skipped, re-import inserts nothing; three vendor rules learned and the next Adobe/Officeworks narrations resolve from memory with zero AI calls; a disagreeing rule is not overwritten; "Donations" created once at 1400, flagged, audited with its lineage, reused on the next import, invisible to another firm |
| `npm run test:db` — ledger and import idempotency | passing (unchanged) |
| `npm run test:idor` | 15 tests, all passing |
| `npm run ai:golden` (MockProvider, as CI runs it) | 28 of 31 correct, abstained on all 3 abstain cases, **0 false auto-approvals** |
| `npm run ai:golden` (gpt-5.5, the key in this machine's `.env`, v4 prompt) | 29 of 31 correct, **0 false auto-approvals** |
| `tsc --noEmit` root and server | clean |

Not verified here: the v4 prompt against `claude-opus-5` (no Anthropic key on this machine), and
the upload dialog in a browser (the new panels typecheck; the stats they read are proven by the
pipeline test).

---

## Part 5 — The AI reviewer tier, 18 September 2026

The practice's direction: the first look a person gives every AI coding should itself be done by
AI, the way a partner reviews a junior's work, so that a person is only needed where judgement
genuinely is. This is the first stage of that. **A person still clicks Accept**; what changes is
how many rows arrive at Accept as Ready rather than as Needs review, and how many confident
mistakes are caught before they get there.

### What runs

After the classifier's batch and the validation gate, every coding that survived — including the
ones the classifier was sure about — goes to a second call with its own prompt
(`prompts/transaction-review/v1.md`, version `transaction-review-v1`) and one thing the classifier
never sees: **the client's signed-off history**, the last forty transactions a person accepted
for this client with the account each went to. The reviewer also sees the classifier's proposal
in full (account, treatment, confidence, reason, vendor, supply), whether the classifier asked
for a person and why, whether the merchant is new to the client, and — for a proposed account —
the proposal as a proposal, before it exists.

It returns one verdict per row: `AGREE`, `DISAGREE` (with the account and treatment it would use,
from the supplied chart) or `ESCALATE`, with its own calibrated confidence and a one-line reason.

### What a verdict does

| Verdict | Effect |
|---|---|
| `AGREE` at or above `RECONCILE_REVIEWER_CONFIDENCE` (0.95) | Stands in for a person's first look. Clears: the classifier's confidence below 0.95; the classifier's own request for a person; a first-time merchant (novelty risk); a row coded to an account created from a proposal in this run. The row is Ready. |
| `AGREE` below the threshold | Recorded; the row goes to review ("AI reviewer not confident enough"). |
| `DISAGREE` | The row goes to review with both codings shown. The classifier's coding stays on the row; the reviewer's suggestion is text and lineage, never applied. |
| `ESCALATE` | The row goes to review with the reviewer's reason. |
| Refusal, unparseable output, transport error | The rows keep exactly the routing the classifier gave them. The reviewer can add a look; it can never remove the gate. |

**What no verdict clears:** a large amount (`RECONCILE_HIGH_RISK_CENTS`), a capital or
balance-sheet posting, a coding that contradicts what a person decided before for the same
merchant, a proposal whose treatment differs from the default of the account the resolver matched
it to, and a journal that will not balance. Those are `hardReview` or risk factors in
`engine.ts`, and `reviewer.ts` documents the boundary.

A `DISAGREE` or `ESCALATE` on a row the classifier was confident about sends it to review. That is
the reviewer catching a confident mistake, which is what a second look is for, and it is the
mechanism by which this tier lowers the false auto-approval rate rather than merely raising the
Ready count.

### Lineage and cost

Every verdict is stored on the row's `aiMeta.reviewer`: provider, model, prompt version, input
hash, verdict, confidence, reason, suggestion, whether it cleared, and when. The run's stats carry
`reviewer: { checked, agreed, disagreed, escalated, cleared, failure }` and the upload dialog
shows them. Token usage counts against the same run totals. The stable half of the request (the
reviewer prompt, the chart, the memory, the history) is cached across the batches of one run, as
the classifier's is.

Two AI calls per transaction that reaches the AI tier, then — which is why the target that rules
and memory resolve 60% before any call matters more, not less.

### Turning it off

`RECONCILE_REVIEWER=off` routes on the classifier alone, as before this tier existed. The mock
provider carries a deterministic reviewer built from the same keyword table as its classifier, so
the offline pipeline test exercises every verdict.

### Departures from Part 3

Items 3 and 6 of Part 3 no longer hold as stated. A transaction that created a new account, and
every row coded to that account in the run, is Ready when the reviewer confirmed the proposal at
or above the threshold; otherwise it waits for a person as before. The account itself is still
created flagged for the advisor, whose tax sign-off is a separate act.

### Not yet built (the next stage, if the practice confirms it)

Auto-acceptance: a firm-level policy, off by default, under which a row the reviewer cleared and
that meets stricter criteria (a merchant a person has coded before, under an amount limit, no new
account) is accepted and posted by the system with an audit row naming the policy version, and
listed in a digest the accountant can reverse from. That changes the governing principle in
CLAUDE.md and is deliberately not done here.

### Verification, 18 September 2026

See the closing note of the change that introduced this section for the suite results.

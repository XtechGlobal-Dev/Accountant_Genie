---
name: reconciliation-engine
description: The reconciliation pipeline — stage order, rules-before-AI, coding memory scoping, confidence vs risk, and abstention. Load BEFORE writing or reviewing any code that classifies, categorises, codes or reconciles bank transactions, or that reads/writes coding memory rules. Triggers on reconcile, reconciliation, classify, categorise, coding, memory rule, confidence, risk, auto-approve, review queue, unknown.
---

# Reconciliation engine

This is the core product. It is also where undisciplined engineering produces books that look
plausible and are wrong.

## Pipeline order — do not reorder

```
normalise
  → duplicate detection
  → merchant/entity resolution
  → coding memory lookup          ← client scope, then firm scope
  → deterministic rules           ← transfers, ATO, bank fees, interest, wages, loans
  → candidate account generation
  → AI classification             ← only what survives to here
  → GST engine                    ← deterministic, never the LLM
  → accounting validation gate
  → confidence + risk scoring
  → auto-process  |  route to review
  → human correction
  → memory update
```

**Rules and memory run before AI, always.** Not for elegance — for four concrete reasons: AI cost,
latency, hallucination, and inconsistency. The same merchant must code the same way every time, and
only a deterministic layer guarantees that.

Target: rules + memory resolve **≥ 60%** of transactions before any AI call. If that number drops,
the fix is more rules, not a better prompt.

## Deterministic rules to implement first

These are unambiguous and must never reach the LLM:

- Transfers between the client's own accounts → `977 Tracking Transfers`, `BAS_EXCLUDED`
- ATO payments → `BAS_EXCLUDED`
- Bank fees → `404`, `INPUT_TAXED`
- Interest charged → `400`, `INPUT_TAXED`
- Interest received → `202`, `INPUT_TAXED`
- Payroll / wages → `477`, `BAS_EXCLUDED`
- Loan repayments → split principal (`840`) from interest (`400`); never expense the whole payment

## Coding memory

Structured rows, **not** a vector store. Every human correction can become a reusable rule.

Scoping, and the precedence order:

```
CLIENT scope   (clientId set)     ← always wins
FIRM scope     (clientId null)    ← fallback
```

When a user moves a transaction, offer exactly three choices:
- **Remember for this client** → `CLIENT` scope
- **Remember for every client** → `FIRM` scope
- **Don't remember** → no rule written

Memory must be **visible, editable and deletable** by the user. A learned rule the user cannot see or
undo is a liability, not a feature.

**Memory never bypasses validation.** If the remembered account is now inactive, or its tax treatment
is invalid for this transaction, the rule does not apply — fall through to the next stage. A stale rule
must degrade to review, never to a bad posting.

Track `evidence_count` and `lastUsedAt`. Repeated corrections raise confidence.

## Confidence is not enough — score risk separately

Confidence alone is a trap:

```
$10 office expense,      confidence 0.97  →  auto-process
$50,000 unknown supplier, confidence 0.97  →  review anyway
```

Risk combines: amount · novelty (unseen merchant) · tax impact · account type · historical
inconsistency. Route on **both** signals. Thresholds are configuration, never hardcoded constants.

Indicative bands, tunable:

| Confidence | Risk | Outcome |
|---|---|---|
| ≥ 0.95 | low | auto-process |
| ≥ 0.95 | high | review |
| 0.80–0.95 | any | review |
| < 0.80 | any | review |

## Abstention is a first-class outcome

The engine is always allowed to answer **Unknown**. Route to account `0 Unknown` (the sentinel `CODE_UNKNOWN` in `server/src/au/coa.ts`; `1` is Suspense) and flag for review.

This is better than a confident wrong classification, and it is never penalised in metrics. Cases that
should abstain rather than guess: ambiguous merchant · unusual or very large amount · conflicting
historical patterns · unclear GST treatment · possible personal-vs-business ambiguity · possible
loan/equity movement · possible capital asset purchase.

## The metric that matters

**False auto-approval rate ≤ 0.5%.** Not raw accuracy.

A transaction routed to review costs an accountant fifteen seconds. A transaction confidently
auto-approved into the wrong account costs them a wrong BAS, and costs us the client. Optimise
accordingly — when in doubt, abstain.

## Before you finish

- [ ] Do rules and memory run before any AI call?
- [ ] Is memory scoped client-then-firm, and re-validated before applying?
- [ ] Can the user see, edit and delete learned rules?
- [ ] Is routing based on confidence **and** risk, from configuration?
- [ ] Can the engine return Unknown, and does it on genuinely ambiguous input?
- [ ] Are thresholds configurable rather than literals in the code?

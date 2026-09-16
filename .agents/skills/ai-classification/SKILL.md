---
name: ai-classification
description: Contract for calling Codex in this codebase — structured output, the validation gate, lineage, batching, prompt caching, PII minimisation and cost control. Load BEFORE writing or reviewing any code that calls the Anthropic API, builds a prompt, defines an AI output schema, or consumes an AI result. Triggers on Codex, Anthropic, LLM, AI, prompt, classification, structured output, model, provider.
---

# AI classification

## The boundary

**AI proposes. Deterministic rules validate. Professionals approve. The ledger is the source of truth.**

The AI layer must never become the source of truth. Concretely, the AI can **never**:

- post to the ledger directly
- post an unbalanced journal
- calculate a GST or BAS figure
- create an invalid tax treatment
- modify a posted entry
- delete an accounting record
- reach another tenant's data
- override a permission check
- execute arbitrary SQL

The AI returns a **proposal**. Deterministic code decides whether it is valid.

## Provider abstraction

Never call the SDK from a route handler or a service. Go through:

```ts
interface AccountingAIProvider {
  classifyTransactions(input: ClassificationInput): Promise<ClassificationResult>;
  identifySubcontractor(input: SubcontractorInput): Promise<SubcontractorResult>;
}
```

Two implementations are required, not one:
- `ClaudeProvider` — production
- `MockProvider` — deterministic, free, offline. This is what makes the test suite runnable in CI and
  lets the whole pipeline be developed without an API key. It is not optional.

## Calling Codex

Model: **`Codex-opus-5`** unless the user explicitly says otherwise. Never downgrade the model to
save cost without an explicit decision — tune `effort` instead.

Use `client.messages.parse()` with a Zod schema via `zodOutputFormat`. Never parse free-form text for
an accounting decision, and never regex an LLM response.

```ts
const response = await client.messages.parse({
  model: "Codex-opus-5",
  max_tokens: 16000,
  output_config: { effort: "medium", format: zodOutputFormat(BatchClassificationSchema) },
  system: [{ type: "text", text: CHART_OF_ACCOUNTS_PROMPT, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: batchPayload }],
});

if (response.stop_reason === "refusal") { /* route batch to review, do not read content */ }
if (!response.parsed_output) { /* route batch to review */ }
```

Two guards are mandatory:
- **Check `stop_reason === "refusal"` before reading content.** Always.
- **`parsed_output` can be null.** Never assert it non-null on a path that touches the ledger.

Both failure modes route the batch to human review. An AI failure is never a silent skip and never a
default coding.

## Structured output contract

Input carries only what is needed to decide:

```json
{
  "transaction": { "description": "AWS AUSTRALIA", "amountCents": -13200, "date": "2026-08-03" },
  "client": { "industry": "Software Development", "gstRegistered": true },
  "candidateAccounts": [{ "code": 433, "name": "Computer Equipment & Software" }],
  "memory": [{ "pattern": "aws", "accountCode": 433 }]
}
```

Output is validated before it goes anywhere near the ledger:

```json
{
  "accountCode": 433,
  "gstTreatment": "GST",
  "confidence": 0.97,
  "reason": "Recurring cloud software expense",
  "needsReview": false
}
```

`needsReview: true` and an `Unknown` outcome are always permitted. Never prompt the model to be
decisive at the expense of abstaining.

## The validation gate — every proposal, no exceptions

```
schema valid?
  → account exists?
  → account belongs to this client's firm?
  → account active?
  → tax treatment valid for this account?
  → GST recomputed deterministically and matches?
  → resulting journal balances?
  → confidence and risk acceptable?
→ only then apply
```

Any failure routes to review. The gate is not advisory.

## Lineage — store this for every decision

`model` · `modelVersion` · `promptVersion` · `rulesVersion` · `memoryVersion` · `inputHash` ·
`output` · `confidence` · `decision` · `timestamp`

This answers the question an accountant will eventually ask: *why did it code it that way?* Without
it, the product is not defensible.

## Prompts live on disk, versioned

```
prompts/transaction-classification/v1.md
prompts/transaction-classification/v2.md
```

Never inline a prompt in business logic. Store `promptVersion` with every decision so a change in
behaviour is explicable.

## Cost control

- **Batch** ~40 transactions per request; preserve per-transaction outputs in the response
- **Cache the chart of accounts** in the system prompt — it is stable per client, so it should be a
  cache hit on every call. Verify with `usage.cache_read_input_tokens`; if it is zero across repeated
  calls, something volatile has crept into the prefix.
- Rules and memory first — the cheapest AI call is the one not made
- Track cost per 1,000 transactions per firm from day one. Margin is an engineering property here.

## PII minimisation

Send the minimum needed to classify. **Never** send passwords, bank credentials, auth tokens, full
account numbers, dates of birth, or personal contact details. Mask where a value is needed for
matching but not in full.

## Regression gate

`tests/ai/golden-transactions.json` holds transaction → expected account → expected treatment →
expected decision. Run it in CI. Do not ship a change to the prompt, the model, memory logic, rules or
tax logic without comparing against it.

## Before you finish

- [ ] Behind the provider interface, with a working mock?
- [ ] Zod-validated structured output, never text parsing?
- [ ] `stop_reason === "refusal"` and null `parsed_output` both handled?
- [ ] Full validation gate before anything touches the ledger?
- [ ] Lineage stored, prompt versioned on disk?
- [ ] Batched, with a verified cache hit on the chart of accounts?
- [ ] No unnecessary PII in the payload?
- [ ] Golden-set regression run?

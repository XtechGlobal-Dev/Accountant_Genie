# Reconciliation

The classification pipeline — Coding Memory, then deterministic rules, then the AI tier for whatever
survives — with abstention allowed at every stage. Owns confidence, risk, the review workflow and
Coding Memory.

Read `.claude/skills/reconciliation-engine/SKILL.md` and `ai-classification` before touching this.

| File | What it owns |
|---|---|
| `config.ts` | Thresholds from the environment (`RECONCILE_*`), never literals |
| `rules.ts` | Deterministic rules over the normalised description — transfers, bank fees, interest, wages, super, ATO, loan repayments |
| `memory.ts` | Coding Memory lookup: client scope beats firm scope, exact beats contains, longer beats shorter |
| `risk.ts` | Risk scored separately from confidence: amount, novelty, capital and balance-sheet postings |
| `engine.ts` | The pipeline. Validation gate on every AI proposal; GST by the engine; writes the coding and `needsReview` |
| `service.ts` | The review workflow: recode (and teach memory), accept (posts the journal), reopen (reverses it), exclude, restore; memory CRUD |
| `actions.ts` | Server actions with permission checks |

The engine never writes to the ledger. Acceptance by a person does, through
`ledger/service.ts#postBankTransactionInTx`, inside one transaction with the audit row. Lineage —
provider, model, prompt version, rules version, memory version — is stored on the transaction.

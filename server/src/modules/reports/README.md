# Reports

The single reporting layer over `JournalLine`. Reports read the ledger; they never do accounting
arithmetic of their own.

| File | What it owns |
|---|---|
| `aggregate.ts` | THE arithmetic: `profitAndLoss` and `simpleBas` as pure functions over ledger lines |
| `period.ts` | A report period from URL params — FY, BAS quarter or month, via `server/au/fy.ts` |
| `repository.ts` | Loads a period's lines through the ownership path |
| `service.ts` | Wires the two together; `null` for a client the firm does not own |

Built: Profit & Loss, Simple BAS (G1, G10, G11, 1A, 1B, W1, W2) with per-label lineage back to the
journal lines. W1/W2 are derived from the wages and PAYG withholding accounts — a mapping that
`REQUIRES_VERIFICATION` by the registered tax advisor.

Not yet built: Balance Sheet, Trial Balance, General Ledger, Transactions (Phase 6); Depreciation,
TPAR, EOFY (Phase 9 — each needs its register first). See `docs/PHASE-PLAN.md`.

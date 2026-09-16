# Ledger

Journal entries and lines, posting, reversal and opening balances. Every journal balances, posted
entries are immutable, and corrections are a reversal plus a correcting entry.

Read `.claude/skills/double-entry-ledger/SKILL.md` before touching this module.

| File | What it owns |
|---|---|
| `validate.ts` | The double-entry invariant as a pure function — no I/O, fully unit tested |
| `schema.ts` | Zod contracts for the journal payload; cents in, never dollars |
| `repository.ts` | Reads walk entry → client → firm. There is no update and no delete. |
| `service.ts` | `postJournal` (the one door to the ledger), `reverseJournal`, reads |
| `actions.ts` | Server actions: session, validate, call, revalidate |

GST on a line is computed here from the account's tax treatment and the client's registration
(`gross / 11` via `server/au/gst.ts`), snapshotted onto the line with the treatment, and never
read from the request. Every post and reversal writes an audit row inside the same transaction.

Posting from a reconciled bank transaction goes through `postBankTransactionInTx`, which builds the
entry from allocations (one for an ordinary coding, principal + interest for a loan repayment) whose
cents must sum to the amount, stamps every line with `bankTransactionId` and the entry with the
GST rules version, and runs on the caller's transaction so the row's status, the entry and the audit
row commit together. An entry posted that way is reversed by reopening the transaction, never from
the journal page.

Database `CHECK`s — debit and credit non-negative, exactly one side per line, entry total
non-negative — ship in `prisma/sql/constraints.sql` and the `20260908000001_constraints` migration.

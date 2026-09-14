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

Not yet built: posting from reconciled bank transactions (Phase 4 calls `postJournal`), a database
`CHECK` on `debitCents >= 0` / `creditCents >= 0` (Phase 1 migration).

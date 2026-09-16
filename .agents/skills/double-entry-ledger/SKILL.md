---
name: double-entry-ledger
description: Double-entry ledger invariants, money representation and posting rules. Load BEFORE writing or reviewing any code that creates, edits, reverses or reads journal entries, journal lines, opening balances, account balances, or any report derived from the ledger. Triggers on journal, ledger, debit, credit, posting, opening balance, trial balance, balance sheet, P&L, reversal, money, cents, amount.
---

# Double-entry ledger

The ledger is the source of truth. Everything else in the product — AI, memory, review, reports — is
machinery around it. If the ledger is wrong, nothing above it can be right.

## Money

**Integer cents everywhere.** Every monetary field is named `...Cents` and typed `Int`.

Never use floating point for money. `0.1 + 0.2 !== 0.3`, and in accounting that surfaces months later
as a trial balance that is out by a cent with no way to find it. Never store money as `Float`, never
parse currency into a `number` of dollars, never use `parseFloat` on an amount.

Convert at the edges only: parse to cents on ingest, format to dollars in the view layer. Everything
between is integers.

Sign convention: **negative = money out of the account**. A `$110` expense is `-11000`.

## The invariant

```
SUM(debits) === SUM(credits)      for every journal entry, always
```

Enforced in three places, because application logic alone is insufficient:

1. The service layer refuses to post an unbalanced entry
2. A database `CHECK` constraint enforces `debit >= 0` and `credit >= 0`
3. Integration tests assert the trial balance sums to zero

Additional rules for every entry:

- Minimum two lines. A one-line journal is never valid.
- Exactly one of `debitCents` / `creditCents` is non-zero per line. Never both.
- A zero-value journal is not valid.

## Posted entries are immutable

**Never `UPDATE` a posted journal.** Corrections are made by:

```
reversal entry  +  correcting entry
```

This preserves the audit trail. An accountant must be able to see what was originally posted, that it
was reversed, and what replaced it. Silently editing history destroys the product's core value
proposition, which is defensibility.

Deletion follows the same logic. Prefer `VOID` / `REVERSE` / `EXCLUDE` over physical deletion. Hard
deletion is permitted only for unposted imported rows, and only under explicit permission.

## Bank transactions become journals

A reconciled bank transaction posts a balanced entry — typically the expense/income account against
the bank account, with GST split out. The `BankTransaction` keeps `journalEntryId` so lineage survives:

```
report figure → journal line → journal entry → bank transaction → statement import → uploaded file
```

Never let a bank transaction affect a report without a journal entry behind it. If a figure appears in
a report that cannot be traced to a journal line, that is a defect.

## Opening balances

An opening balance is a **real journal**, dated 1 July of the chosen financial year, that balances like
any other. It is never a set of detached fields on the client record. Same invariant, same immutability.

## Reports read the ledger, and only the ledger

There is **one** reporting layer over `JournalLine`. P&L, Balance Sheet, Trial Balance, General Ledger,
Transactions Report and BAS all read through it.

Never give a report its own accounting arithmetic. That is exactly how you end up with a P&L saying
$50,000, a trial balance saying $49,999, and a BAS saying something else again — with no way to tell
which one is right.

Assertions to surface in the UI rather than hide:
- Trial balance must sum to zero
- `Assets = Liabilities + Equity` — if it fails, show a warning banner, do not silently round

## Before you finish

- [ ] Is every amount integer cents, with a `...Cents` name?
- [ ] Does every entry balance, enforced in service + DB + test?
- [ ] Are posted entries immutable, with corrections as reversals?
- [ ] Does every reported figure trace to a journal line?
- [ ] Did you add accounting arithmetic to a report instead of the reporting layer?

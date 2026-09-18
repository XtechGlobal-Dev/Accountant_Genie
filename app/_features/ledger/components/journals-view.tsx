"use client";

/**
 * A client's journals: everything posted to the ledger, oldest first and
 * numbered, and the two ways to post more — a manual entry, or the opening
 * balances for a financial year.
 *
 * Each entry is laid out the way a journal is read: debit account and
 * amount beside credit account and amount, one row per pair of lines. GST
 * is shown on its own line against GST Receivable or GST Payable, split
 * from the gross the ledger holds — see `shared/journal-presentation.ts`.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountOption } from "@/shared/contracts/account";
import type { JournalEntryRow } from "@/shared/contracts/journal";
import { shortDate } from "@/shared/format";
import { presentJournal, type DisplayLine } from "@/shared/journal-presentation";
import { JOURNAL_SOURCE_LABELS } from "@/shared/labels";
import { Badge, Button, ButtonLink, EmptyState, Money, PageHeader } from "@/ui/primitives";
import { JournalModal } from "./journal-modal";

type Open = "MANUAL" | "OPENING" | null;

export function JournalsView({
  clientId,
  entries,
  accounts,
  financialYears,
  subcontractors,
  initialOpen,
}: {
  clientId: string;
  entries: JournalEntryRow[];
  accounts: AccountOption[];
  financialYears: number[];
  subcontractors: { id: string; name: string }[];
  initialOpen: Open;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(initialOpen);

  function close() {
    setOpen(null);
    // Drop ?new=1 / ?opening=1 so a refresh does not reopen the dialog.
    router.replace(`/clients/${clientId}/journals`);
  }

  // Oldest first, numbered in that order — the way a journal is read.
  const ordered = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journals"
        context="Every entry posted to this client's ledger. Posted entries are immutable; corrections are reversals."
        action={
          <>
            <ButtonLink variant="secondary" icon="download" href={`/clients/${clientId}/journals/export?format=xero&fy=${financialYears[0] ?? ""}`} prefetch={false}>
              Xero export
            </ButtonLink>
            <ButtonLink variant="secondary" icon="download" href={`/clients/${clientId}/journals/export?format=myob&fy=${financialYears[0] ?? ""}`} prefetch={false}>
              MYOB export
            </ButtonLink>
            <Button variant="secondary" icon="book-open" onClick={() => setOpen("OPENING")}>
              Opening balances
            </Button>
            <Button icon="plus" onClick={() => setOpen("MANUAL")}>
              New journal
            </Button>
          </>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          icon="book-open"
          title="Nothing posted yet"
          body="Start the ledger with the opening balances for the financial year, or post a manual journal. Reconciled bank transactions will post here automatically."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" icon="book-open" onClick={() => setOpen("OPENING")}>
                Opening balances
              </Button>
              <Button icon="plus" onClick={() => setOpen("MANUAL")}>
                New journal
              </Button>
            </div>
          }
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table className="journal">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th className="w-28">Date</th>
                <th>Description</th>
                <th className="w-48">Debit Account</th>
                <th className="w-32 text-right">Debit (AUD)</th>
                <th className="w-48">Credit Account</th>
                <th className="w-32 text-right">Credit (AUD)</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((entry, index) => (
                <JournalRows key={entry.id} clientId={clientId} entry={entry} number={index + 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <JournalModal
          key={open}
          clientId={clientId}
          accounts={accounts}
          mode={open}
          financialYears={financialYears}
          subcontractors={subcontractors}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/**
 * One entry as a block of rows: the first row carries the number, the date
 * and the description; every row pairs the next debit line with the next
 * credit line, so a two-line journal is one row and a GST split adds one.
 */
function JournalRows({ clientId, entry, number }: { clientId: string; entry: JournalEntryRow; number: number }) {
  const { debits, credits } = presentJournal(entry.lines);
  const rowCount = Math.max(debits.length, credits.length, 1);
  const rows = Array.from({ length: rowCount }, (_, i) => ({ debit: debits[i], credit: credits[i] }));

  return (
    <>
      {rows.map((row, i) => (
        <tr key={`${entry.id}-${i}`} className={i > 0 ? "continuation" : undefined}>
          {i === 0 ? (
            <>
              <td className="figure text-ink-2" rowSpan={rowCount}>
                {number}
              </td>
              <td className="figure text-ink-2 align-top" rowSpan={rowCount}>
                {shortDate(entry.date)}
              </td>
              <td className="align-top" rowSpan={rowCount}>
                <Link
                  href={`/clients/${clientId}/journals/${entry.id}`}
                  className="font-medium text-ink transition-colors hover:text-accent"
                >
                  {entry.description ?? (entry.isReversal ? "Reversal" : "Journal entry")}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  {entry.reference ? <span className="code">{entry.reference}</span> : null}
                  <Badge tone={entry.source === "OPENING" ? "accent" : "neutral"}>
                    {JOURNAL_SOURCE_LABELS[entry.source]}
                  </Badge>
                  {entry.reversedById ? (
                    <Badge tone="warning">Reversed</Badge>
                  ) : entry.isReversal ? (
                    <Badge tone="outline">Reversal</Badge>
                  ) : null}
                  {entry.postedBy ? <span>by {entry.postedBy}</span> : null}
                </div>
              </td>
            </>
          ) : null}
          <LineCells line={row.debit} />
          <LineCells line={row.credit} />
        </tr>
      ))}
    </>
  );
}

function LineCells({ line }: { line: DisplayLine | undefined }) {
  if (!line) {
    return (
      <>
        <td />
        <td />
      </>
    );
  }
  return (
    <>
      <td className={line.isGst ? "text-ink-2" : "font-medium"}>{line.accountName}</td>
      <td className="text-right">
        <Money cents={line.cents} />
      </td>
    </>
  );
}

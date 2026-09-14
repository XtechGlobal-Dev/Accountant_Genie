"use client";

/**
 * A client's journals: everything posted to the ledger, newest first, and
 * the two ways to post more — a manual entry, or the opening balances for a
 * financial year.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountOption } from "@/shared/contracts/account";
import type { JournalEntryRow } from "@/shared/contracts/journal";
import { shortDate } from "@/shared/format";
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
          <table>
            <thead>
              <tr>
                <th className="w-32">Date</th>
                <th className="w-32">Reference</th>
                <th>Description</th>
                <th className="w-36">Source</th>
                <th className="w-20 text-right">Lines</th>
                <th className="w-36 text-right">Total</th>
                <th className="w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="figure text-ink-2">{shortDate(entry.date)}</td>
                  <td className="code text-ink-2">{entry.reference ?? "—"}</td>
                  <td>
                    <Link
                      href={`/clients/${clientId}/journals/${entry.id}`}
                      className="font-medium text-ink transition-colors hover:text-accent"
                    >
                      {entry.description ?? (entry.isReversal ? "Reversal" : "Journal entry")}
                    </Link>
                    {entry.postedBy ? (
                      <span className="ml-2 text-xs text-ink-3">by {entry.postedBy}</span>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={entry.source === "OPENING" ? "accent" : "neutral"}>
                      {JOURNAL_SOURCE_LABELS[entry.source]}
                    </Badge>
                  </td>
                  <td className="figure text-right text-ink-2">{entry.lineCount}</td>
                  <td className="text-right">
                    <Money cents={entry.totalCents} />
                  </td>
                  <td>
                    {entry.reversedById ? (
                      <Badge tone="warning">Reversed</Badge>
                    ) : entry.isReversal ? (
                      <Badge tone="outline">Reversal</Badge>
                    ) : (
                      <Badge tone="positive">Posted</Badge>
                    )}
                  </td>
                </tr>
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

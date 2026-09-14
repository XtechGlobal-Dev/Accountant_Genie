import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getJournal } from "@/server/modules/ledger/service";
import { shortDate } from "@/shared/format";
import { GST_TREATMENT_LABELS, JOURNAL_SOURCE_LABELS } from "@/shared/labels";
import { ReverseJournalButton } from "@/features/ledger/components/reverse-journal-button";
import { Alert, Badge, ButtonLink, Card, CardHeader, Money } from "@/ui/primitives";

export const metadata: Metadata = { title: "Journal entry" };

/** One posted entry, exactly as it was posted. */
export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  const { firmId } = await requireSession();

  const entry = await getJournal(firmId, id, entryId);
  if (!entry) notFound();

  const totalDebits = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
  const totalCredits = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
  const canReverse = entry.reversedBy === null && entry.reverses === null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {entry.description ?? (entry.reverses ? "Reversal" : "Journal entry")}
            </h2>
            <Badge tone={entry.source === "OPENING" ? "accent" : "neutral"}>
              {JOURNAL_SOURCE_LABELS[entry.source]}
            </Badge>
            {entry.reversedBy ? <Badge tone="warning">Reversed</Badge> : null}
            {entry.reverses ? <Badge tone="outline">Reversal</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-ink-2">
            <span className="figure">{shortDate(entry.date)}</span>
            {entry.reference ? (
              <>
                {" · "}
                <span className="code">{entry.reference}</span>
              </>
            ) : null}
            {entry.postedBy ? ` · posted by ${entry.postedBy}` : null}
            {" · recorded "}
            <span className="figure">{shortDate(entry.createdAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${id}/journals`}>
            All journals
          </ButtonLink>
          {canReverse ? (
            <ReverseJournalButton
              clientId={id}
              entryId={entry.id}
              originalDate={entry.date.toISOString().slice(0, 10)}
            />
          ) : null}
        </div>
      </div>

      {entry.reversedBy ? (
        <Alert tone="warning" title="This journal has been reversed">
          Its effect was cancelled by{" "}
          <Link
            href={`/clients/${id}/journals/${entry.reversedBy.id}`}
            className="font-semibold underline"
          >
            the reversal dated {shortDate(entry.reversedBy.date)}
          </Link>
          . Both entries stay on the ledger.
        </Alert>
      ) : null}
      {entry.reverses ? (
        <Alert tone="info" title="This journal is a reversal">
          It cancels{" "}
          <Link
            href={`/clients/${id}/journals/${entry.reverses.id}`}
            className="font-semibold underline"
          >
            the journal dated {shortDate(entry.reverses.date)}
          </Link>
          .
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Lines"
          description="GST is the amount the posting engine computed from each account's tax code at the time."
        />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="w-20">Code</th>
                <th className="w-56">Account</th>
                <th>Description</th>
                <th className="w-40">Tax code</th>
                <th className="w-32 text-right">Debit</th>
                <th className="w-32 text-right">Credit</th>
                <th className="w-28 text-right">GST</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.id}>
                  <td className="code text-ink-2">{line.accountCode}</td>
                  <td className="font-medium">{line.accountName}</td>
                  <td className="text-ink-2">{line.description ?? "—"}</td>
                  <td className="text-ink-2">
                    {line.gstTreatment ? GST_TREATMENT_LABELS[line.gstTreatment] : "—"}
                  </td>
                  <td className="text-right">
                    {line.debitCents > 0 ? <Money cents={line.debitCents} /> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="text-right">
                    {line.creditCents > 0 ? <Money cents={line.creditCents} /> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="text-right">
                    {line.gstCents !== 0 ? <Money cents={line.gstCents} /> : <span className="text-ink-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Totals</td>
                <td className="text-right">
                  <Money cents={totalDebits} emphasis />
                </td>
                <td className="text-right">
                  <Money cents={totalCredits} emphasis />
                </td>
                <td className="text-right text-ink-2">
                  {totalDebits === totalCredits ? "Balanced" : "Out of balance"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

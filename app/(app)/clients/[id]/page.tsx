import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientOverview } from "@/server/modules/clients/service";
import { currentFinancialYear, quarterOf, quarterRange } from "@/server/au/fy";
import { shortDate } from "@/shared/format";
import { BANK_KIND_LABELS, IMPORT_STATUS_LABELS } from "@/shared/labels";
import { AddNoteForm } from "@/features/clients/components/add-note-form";
import { ClientEmptyState } from "@/features/clients/components/client-empty-state";
import { Badge, ButtonLink, Card, CardHeader, StatCard } from "@/ui/primitives";

/**
 * The client overview: where the work stands right now.
 *
 * Every figure here is a count of rows this firm owns — nothing is estimated,
 * and nothing is derived from the ledger, which the reporting layer will own.
 */

export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Re-scoped here rather than trusted from the layout: a page is API surface
  // of its own, and layouts do not re-run on every navigation.
  const { firmId } = await requireSession();

  const overview = await getClientOverview(firmId, id);
  if (!overview) notFound();

  const { bankAccounts, counts, imports, notes, journalCount } = overview;

  const fy = currentFinancialYear();
  const quarter = quarterRange(fy, quarterOf(new Date()));

  if (bankAccounts.length === 0 && counts.transactions === 0 && journalCount === 0) {
    return <ClientEmptyState clientId={id} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bank accounts"
          value={bankAccounts.length}
          icon="landmark"
          href={`/clients/${id}/banks`}
          hint={bankAccounts.length === 0 ? "None connected yet" : "Manage accounts"}
        />
        <StatCard
          label="Transactions"
          value={counts.transactions.toLocaleString("en-AU")}
          icon="receipt"
          href={`/clients/${id}/transactions`}
          hint="Imported statement lines"
        />
        <StatCard
          label="Awaiting review"
          value={counts.awaitingReview.toLocaleString("en-AU")}
          icon="list-checks"
          tone={counts.awaitingReview > 0 ? "warning" : "default"}
          dot={counts.awaitingReview > 0 ? "warning" : "neutral"}
          href={`/clients/${id}/transactions`}
          hint="Coded by the engine, not yet signed off"
        />
        <StatCard
          label="Journals"
          value={journalCount.toLocaleString("en-AU")}
          icon="book-open"
          href={`/clients/${id}/journals`}
          hint={journalCount === 0 ? "Nothing posted to the ledger yet" : "Posted to the ledger"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Bank accounts"
              description="Where this client&rsquo;s transactions come from."
              action={
                <ButtonLink variant="secondary" size="sm" href={`/clients/${id}/banks`}>
                  Manage
                </ButtonLink>
              }
            />
            {bankAccounts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
                <p className="max-w-sm text-sm leading-relaxed text-ink-2">
                  A bank account is the first thing a client needs. Statements
                  import into it, and its transactions become the ledger.
                </p>
                <ButtonLink href={`/clients/${id}/banks`} icon="plus" size="sm">
                  Add a bank account
                </ButtonLink>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="w-40">Type</th>
                    <th className="w-32 text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((account) => (
                    <tr key={account.id}>
                      <td>
                        <span className="font-medium">{account.name}</span>
                        {account.accountMask ? (
                          <span className="code ml-2 text-ink-3">
                            &bull;&bull;&bull;&bull;{account.accountMask}
                          </span>
                        ) : null}
                        {account.isCashAtBank ? (
                          <Badge tone="accent" className="ml-2">
                            Cash at bank
                          </Badge>
                        ) : null}
                      </td>
                      <td className="text-ink-2">{BANK_KIND_LABELS[account.kind]}</td>
                      <td className="figure text-right text-ink-2">
                        {account.transactionCount.toLocaleString("en-AU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Statement imports"
              description="Every import keeps its file, its row count and its duplicates."
            />
            {imports.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-2">
                Nothing imported yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th className="w-48">Account</th>
                      <th className="w-24 text-right">Rows</th>
                      <th className="w-28 text-right">Duplicates</th>
                      <th className="w-36">Status</th>
                      <th className="w-32">Imported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((row) => (
                      <tr key={row.id}>
                        <td className="truncate font-medium">{row.filename}</td>
                        <td className="text-ink-2">{row.bankAccountName}</td>
                        <td className="figure text-right text-ink-2">
                          {row.rowCount.toLocaleString("en-AU")}
                        </td>
                        <td className="figure text-right text-ink-2">
                          {row.duplicateCount.toLocaleString("en-AU")}
                        </td>
                        <td>
                          <Badge
                            tone={
                              row.status === "FAILED"
                                ? "negative"
                                : row.status === "COMPLETE"
                                  ? "positive"
                                  : "warning"
                            }
                          >
                            {IMPORT_STATUS_LABELS[row.status]}
                          </Badge>
                        </td>
                        <td className="text-ink-2">{shortDate(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Ledger"
              description="Post to the ledger and read what it says."
            />
            <div className="flex flex-col gap-2 px-5 py-4">
              <ButtonLink icon="upload" href={`/clients/${id}/banks?upload=1`}>
                Upload bank statement
              </ButtonLink>
              <ButtonLink variant="secondary" icon="receipt" href={`/clients/${id}/transactions`}>
                Review transactions
              </ButtonLink>
              <ButtonLink variant="secondary" icon="plus" href={`/clients/${id}/journals?new=1`}>
                New journal entry
              </ButtonLink>
              <ButtonLink variant="secondary" icon="book-open" href={`/clients/${id}/journals?opening=1`}>
                Opening balances
              </ButtonLink>
              <ButtonLink variant="secondary" icon="bar-chart" href={`/clients/${id}/reports/profit-and-loss`}>
                Profit &amp; Loss
              </ButtonLink>
              <ButtonLink variant="secondary" icon="calculator" href={`/clients/${id}/reports/bas`}>
                Business Activity Statement
              </ButtonLink>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Current period"
              description="Australian financial year, 1 July to 30 June."
            />
            <dl className="flex flex-col gap-3 px-5 py-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">Financial year</dt>
                <dd className="figure font-semibold">FY{fy}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">BAS quarter</dt>
                <dd className="figure font-semibold">{quarter.label.split(" ")[1]}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">Period</dt>
                <dd className="figure text-ink-2">
                  {shortDate(quarter.start)} &mdash;{" "}
                  {shortDate(new Date(quarter.end.getTime() - 86_400_000))}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              description="Standing context the next person needs before they code."
            />
            <div className="flex flex-col gap-4 px-5 py-4">
              {notes.length === 0 ? (
                <p className="text-sm text-ink-2">
                  No notes yet &mdash; the private-use split, the odd arrangement, the
                  thing worth remembering.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-control border border-rule bg-surface-2 px-3.5 py-3"
                    >
                      <p className="text-sm font-semibold">{note.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{note.body}</p>
                      <p className="mt-2 text-xs text-ink-3">{shortDate(note.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <AddNoteForm clientId={id} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

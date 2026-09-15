import { EmptyHero, HeroAction, HeroDivider } from "@/ui/empty-hero";

/**
 * A report asked for before the ledger has anything in it. Every report
 * derives from the ledger, and the ledger starts with the first statement
 * or journal — so the ways in are the same three the client overview offers.
 *
 * Server component: it is links and layout only.
 */
export function ReportsEmptyState({ clientId }: { clientId: string }) {
  const base = `/clients/${clientId}`;
  return (
    <EmptyHero
      title="No Reports Found"
      body="No files were uploaded to generate this report. Reports derive from the ledger, and the ledger starts with the first bank statement or journal entry."
      note={{
        title: "Every figure will trace back to its source",
        body: "Report figure to BAS label to journal line to transaction to statement row to the uploaded file. Nothing here is estimated.",
      }}
    >
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <HeroAction href={`${base}/banks?upload=1`} icon="upload" title="Upload Bank Statements" body="Import from a CSV or a bank statement PDF" primary />
        <HeroAction href={`${base}/banks?feed=1`} icon="link" title="Connect Live Bank Feeds" body="Automatically import the client's transactions" />
      </div>
      <HeroDivider />
      <HeroAction
        href={`${base}/journals?new=1`}
        icon="book-open"
        title="Add Journal Entry Manually"
        body="Opening balances or a first entry start the ledger too"
        className="sm:max-w-sm"
      />
    </EmptyHero>
  );
}

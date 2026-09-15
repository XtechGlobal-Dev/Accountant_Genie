import { EmptyHero, HeroAction, HeroDivider } from "@/ui/empty-hero";

/**
 * A client with nothing in it yet: no bank account, no transaction, no
 * journal. Three ways in, in the order the firm should prefer them — a live
 * feed, a statement file, a journal — and a note on what a file can be.
 *
 * Server component: it is links and layout only.
 */
export function ClientEmptyState({ clientId }: { clientId: string }) {
  const base = `/clients/${clientId}`;
  return (
    <EmptyHero
      title="No Data Found"
      body="Connect a live bank feed or upload bank transactions under Banks, or post a journal entry to start a financial year."
      note={{
        title: "Supported file formats: CSV and bank statement PDFs",
        body: "Every upload is kept with its import, so each figure can be traced back to the file it came from.",
      }}
    >
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <HeroAction href={`${base}/banks?feed=1`} icon="link" title="Connect Live Bank Feed" body="Automatically import your transactions" primary />
        <HeroAction href={`${base}/banks?upload=1`} icon="upload" title="Upload Bank File" body="Import from a CSV or a bank statement PDF" />
      </div>
      <HeroDivider />
      <HeroAction
        href={`${base}/journals?new=1`}
        icon="book-open"
        title="Add Journal Entry Manually"
        body="Record a transaction to get started"
        className="sm:max-w-sm"
      />
    </EmptyHero>
  );
}

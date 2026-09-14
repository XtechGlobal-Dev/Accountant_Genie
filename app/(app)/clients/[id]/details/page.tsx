import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientDetail, getPartners } from "@/server/modules/clients/service";
import { abn as formatAbn, money, shortDate } from "@/shared/format";
import { BAS_FREQUENCY_LABELS, ENTITY_LABELS, GST_BASIS_LABELS } from "@/shared/labels";
import { EditClientButton } from "@/features/clients/components/edit-client-modal";
import { PartnersCard } from "@/features/clients/components/partners-card";
import { Icon } from "@/ui/icons";
import { buttonClass, cx } from "@/ui/styles";
import { Alert, Card, CardHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Client info" };

/**
 * The client's standing details, in three tabs: who they are, what kind of
 * entity they are (and who owns it), and the balances the books start with.
 * The tab is part of the URL so the sidebar can point at each one.
 */

type Tab = "basic" | "entity" | "opening";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "basic", label: "Basic Info" },
  { id: "entity", label: "Business Entity" },
  { id: "opening", label: "Opening Balance" },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule-soft py-2.5 last:border-b-0">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

export default async function ClientDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "entity" || rawTab === "opening" ? rawTab : "basic";
  const { firmId } = await requireSession();

  const client = await getClientDetail(firmId, id);
  if (!client) notFound();

  const partners = client.entityType === "PARTNERSHIP" ? await getPartners(firmId, id) : null;
  const partnerTotal = partners?.reduce((sum, partner) => sum + partner.shareBasisPoints, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Client info" className="flex flex-wrap items-center gap-2">
          {TABS.map((item) => {
            const active = item.id === tab;
            const flagged = item.id === "entity" && partners !== null && partnerTotal !== 10_000;
            return (
              <Link
                key={item.id}
                href={`/clients/${id}/details?tab=${item.id}`}
                role="tab"
                aria-selected={active}
                className={cx(
                  "relative inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-semibold transition-colors",
                  active ? "border-accent bg-accent-soft text-accent-ink" : "border-rule bg-surface text-ink hover:border-accent/40",
                )}
              >
                {item.label}
                {flagged ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warning ring-2 ring-surface" /> : null}
              </Link>
            );
          })}
        </div>
        {tab !== "opening" ? <EditClientButton client={client} /> : null}
      </div>

      {tab === "basic" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Business" description="Who the client is." />
            <dl className="px-5 py-2">
              <Row label="Business name" value={client.businessName} />
              <Row label="Legal name" value={client.legalName ?? "—"} />
              <Row label="ABN" value={<span className="figure">{formatAbn(client.abn)}</span>} />
              <Row label="Industry" value={client.industry ?? "—"} />
              <Row
                label="Email"
                value={client.email ? <a href={`mailto:${client.email}`} className="text-accent hover:underline">{client.email}</a> : "—"}
              />
              <Row label="Phone" value={client.phone ?? "—"} />
              <Row label="Client since" value={shortDate(client.createdAt)} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Tax profile" description="GST registration and reporting cycle." />
            <dl className="px-5 py-2">
              <Row label="Registered for GST" value={client.gstRegistered ? "Yes" : "No"} />
              <Row label="GST basis" value={client.gstRegistered ? GST_BASIS_LABELS[client.gstBasis] : "Not applicable"} />
              <Row label="BAS frequency" value={client.gstRegistered ? BAS_FREQUENCY_LABELS[client.basFrequency] : "Not applicable"} />
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === "entity" ? (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Entity" description="The structure decides which equity accounts the chart needs and how profit is distributed." />
            <dl className="px-5 py-2">
              <Row label="Entity type" value={ENTITY_LABELS[client.entityType]} />
              {client.entityType === "COMPANY" ? (
                <Row label="Income tax rate" value={<span className="figure">{client.incomeTaxRate ?? 25}%</span>} />
              ) : null}
              {client.entityType === "UNIT_TRUST" ? (
                <>
                  <Row label="Total units" value={<span className="figure">{client.totalUnits?.toLocaleString("en-AU") ?? "—"}</span>} />
                  <Row label="Value per unit" value={<span className="figure">{client.unitValueCents === null ? "—" : money(client.unitValueCents)}</span>} />
                </>
              ) : null}
            </dl>
          </Card>
          {partners ? (
            <>
              {partnerTotal !== 10_000 ? (
                <Alert tone="warning" title="Partner shares do not add up to 100%">
                  Distributions cannot be prepared until they do. Edit the partners below.
                </Alert>
              ) : null}
              <PartnersCard clientId={id} partners={partners} />
            </>
          ) : (
            <p className="text-xs leading-relaxed text-ink-3">
              Partners are recorded for partnerships only. Changing the entity type clears the fields that belong to the previous type.
            </p>
          )}
        </div>
      ) : null}

      {tab === "opening" ? (
        <Card>
          <CardHeader
            title="Opening balances"
            description="The balances the books start with on 1 July of the first financial year kept here."
            action={
              <Link href={`/clients/${id}/journals?opening=1`} className={buttonClass({ className: "rounded-full" })}>
                <Icon name="book-open" />
                Set opening balances
              </Link>
            }
          />
          <div className="grid gap-4 px-5 py-5 md:grid-cols-3">
            {[
              { step: "1", title: "Pick the financial year", body: "The journal is dated 1 July of that year and posted once." },
              { step: "2", title: "Enter each balance", body: "Bank, receivables, payables, loans, equity — debits must equal credits." },
              { step: "3", title: "Post it", body: "It appears in Journals like any other entry and every report starts from it." },
            ].map((item) => (
              <div key={item.step} className="rounded-2xl border border-rule bg-surface-2 p-4">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{item.step}</span>
                <p className="mt-3 text-sm font-bold">{item.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-3">
            Opening balances posted so far are listed under{" "}
            <Link href={`/clients/${id}/journals`} className="font-semibold text-accent hover:underline">
              Journals
            </Link>
            . Posted entries are immutable; a correction is a reversal plus a new entry.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

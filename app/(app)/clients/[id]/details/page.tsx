import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientDetail, getClientNotes, getPartners, getTrustDetails } from "@/server/modules/clients/service";
import { abn as formatAbn, money, shortDate } from "@/shared/format";
import { BAS_FREQUENCY_LABELS, ENTITY_LABELS, GST_BASIS_LABELS } from "@/shared/labels";
import { AddNoteForm } from "@/features/clients/components/add-note-form";
import { ClientLogoUploader } from "@/features/clients/components/client-logo-uploader";
import { EditClientButton } from "@/features/clients/components/edit-client-modal";
import { PartnersCard } from "@/features/clients/components/partners-card";
import { TrustDetailsCard } from "@/features/clients/components/trust-details-card";
import { Icon, type IconName } from "@/ui/icons";
import { buttonClass, cx } from "@/ui/styles";
import { Alert, Badge, Card, CardHeader } from "@/ui/primitives";
import { CopyButton } from "@/ui/copy-button";

export const metadata: Metadata = { title: "Client info" };

/**
 * The client's standing details, in three tabs: who they are, what kind of
 * entity they are (and who owns it), and the balances the books start with.
 * The tab is part of the URL so the sidebar can point at each one.
 */

type Tab = "basic" | "entity" | "opening";
const TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> = [
  { id: "basic", label: "Basic Info", icon: "user" },
  { id: "entity", label: "Business Entity", icon: "building" },
  { id: "opening", label: "Opening Balance", icon: "scale" },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** A value the client has not given yet. */
const Empty = () => <span className="font-normal text-ink-3">&mdash;</span>;

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
  const notes = tab === "basic" ? ((await getClientNotes(firmId, id)) ?? []) : [];
  const isTrust = client.entityType === "UNIT_TRUST" || client.entityType === "DISCRETIONARY_TRUST";
  const trust = isTrust ? await getTrustDetails(firmId, id) : null;
  const trustIncomplete = trust !== null && (trust.trustee === null || trust.beneficiaries.length === 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Client info" className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-rule bg-surface p-1 shadow-xs">
          {TABS.map((item) => {
            const active = item.id === tab;
            const flagged = item.id === "entity" && ((partners !== null && partnerTotal !== 10_000) || trustIncomplete);
            return (
              <Link
                key={item.id}
                href={`/clients/${id}/details?tab=${item.id}`}
                role="tab"
                aria-selected={active}
                className={cx(
                  "relative inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors",
                  active ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-transparent text-ink-2 hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon name={item.icon} className={cx("size-4", active ? "text-accent" : "text-ink-3")} />
                {item.label}
                {flagged ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warning ring-2 ring-surface" /> : null}
              </Link>
            );
          })}
        </div>
        {tab !== "opening" ? <EditClientButton client={client} /> : null}
      </div>

      {tab === "basic" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-5">
            <Card>
              <CardHeader icon="landmark" title="Business" description="Who the client is." />
              <div className="border-b border-rule-soft px-6 py-4">
                <p className="mb-3 text-[13px] text-ink-2">Business logo</p>
                <ClientLogoUploader clientId={id} hasLogo={client.hasLogo} businessName={client.businessName} />
              </div>
              <dl className="px-6 py-2">
                <Row label="Business name" value={client.businessName} />
                <Row label="Legal name" value={client.legalName ?? <Empty />} />
                <Row
                  label="ABN"
                  value={
                    client.abn ? (
                      <>
                        <span className="figure">{formatAbn(client.abn)}</span>
                        <CopyButton value={client.abn.replace(/\s+/g, "")} label="ABN" />
                      </>
                    ) : (
                      <Empty />
                    )
                  }
                />
                <Row
                  label="Industry"
                  value={
                    client.industry ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-ink">
                        <Icon name="briefcase" className="size-3.5" />
                        {client.industry}
                      </span>
                    ) : (
                      <Empty />
                    )
                  }
                />
                <Row
                  label="Email"
                  value={client.email ? <a href={`mailto:${client.email}`} className="text-accent hover:underline">{client.email}</a> : <Empty />}
                />
                <Row label="Phone" value={client.phone ? <span className="figure">{client.phone}</span> : <Empty />} />
                <Row
                  label="Client since"
                  value={
                    <>
                      <Icon name="calendar" className="size-3.5 text-ink-3" />
                      <span className="figure">{shortDate(client.createdAt)}</span>
                    </>
                  }
                />
                <Row
                  label="Registered for GST"
                  value={
                    client.gstRegistered ? (
                      <Badge tone="positive">
                        <Icon name="check-circle" className="mr-1 size-3.5" />
                        Yes
                      </Badge>
                    ) : (
                      <Badge tone="negative">
                        <Icon name="x-circle" className="mr-1 size-3.5" />
                        No
                      </Badge>
                    )
                  }
                />
                {client.gstRegistered ? (
                  <>
                    <Row label="GST basis" value={GST_BASIS_LABELS[client.gstBasis]} />
                    <Row label="BAS frequency" value={BAS_FREQUENCY_LABELS[client.basFrequency]} />
                  </>
                ) : null}
              </dl>
            </Card>
          </div>

          <div className="card relative flex items-center gap-4 overflow-hidden px-6 py-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-4 ring-accent-soft/40">
              <Icon name="info" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Client information</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                These details flow into every report and BAS prepared for this client. Keep them current so the records stay accurate.
              </p>
            </div>
            <InfoArt />
          </div>
        </div>

        <Card className="min-w-0 self-start">
          <CardHeader icon="clipboard-list" title="Notes" description="Standing context the next person needs before they code." />
          <div className="flex flex-col gap-4 px-5 py-4">
            {notes.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-2">No notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {notes.map((note) => (
                  <li key={note.id} className="rounded-control border border-rule bg-surface-2 px-3.5 py-3">
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
      ) : null}

      {tab === "entity" ? (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Entity" description="The structure decides which equity accounts the chart needs and how profit is distributed." />
            <dl className="px-5 py-2">
              <Row label="Entity type" value={ENTITY_LABELS[client.entityType]} />
              {client.entityType === "COMPANY" ? (
                <Row label="Income tax rate" value={<span className="figure">{client.incomeTaxRatePercent ?? 25}%</span>} />
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
          ) : trust ? (
            <>
              {trustIncomplete ? (
                <Alert tone="warning" title="The trust has no trustee or beneficiaries recorded">
                  Distributions cannot be prepared until there is a trustee and at least one beneficiary. Add them below.
                </Alert>
              ) : null}
              <TrustDetailsCard clientId={id} details={trust} />
            </>
          ) : (
            <p className="text-xs leading-relaxed text-ink-3">
              Partners are recorded for partnerships, and a trustee and beneficiaries for trusts. Changing the entity type clears the fields that belong to the previous type.
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

/** Two statement pages, tucked into the corner of the note. Decoration only. */
function InfoArt() {
  return (
    <svg viewBox="0 0 120 72" className="absolute -bottom-3 right-6 hidden h-20 w-32 md:block" aria-hidden="true" fill="none">
      <rect x="44" y="6" width="48" height="60" rx="8" className="fill-accent-soft" transform="rotate(8 68 36)" />
      <rect x="30" y="12" width="48" height="60" rx="8" className="fill-surface stroke-rule drop-shadow-[0_6px_12px_rgba(15,19,48,0.10)]" />
      <circle cx="44" cy="26" r="5" className="fill-accent" fillOpacity="0.55" />
      <rect x="53" y="22" width="18" height="3" rx="1.5" className="fill-ink-3" fillOpacity="0.5" />
      <rect x="53" y="28" width="12" height="3" rx="1.5" className="fill-ink-3" fillOpacity="0.3" />
      <rect x="39" y="40" width="30" height="3" rx="1.5" className="fill-ink-3" fillOpacity="0.4" />
      <rect x="39" y="48" width="24" height="3" rx="1.5" className="fill-ink-3" fillOpacity="0.3" />
      <rect x="39" y="56" width="28" height="3" rx="1.5" className="fill-ink-3" fillOpacity="0.25" />
    </svg>
  );
}

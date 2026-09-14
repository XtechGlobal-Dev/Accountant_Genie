import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { getClientHeader } from "@/server/modules/clients/service";
import { abn as formatAbn } from "@/shared/format";
import { BAS_FREQUENCY_LABELS, ENTITY_LABELS, GST_BASIS_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Badge } from "@/ui/primitives";

/**
 * One client's workspace: a slim identity strip that stays put, and the
 * section below it. The sections themselves are reached from the sidebar,
 * which nests them under the client while it is open.
 *
 * The header is loaded here so every section shows the same standing facts
 * without each page re-querying them. Each page still re-authenticates and
 * re-scopes its own data: a layout is not an authorisation boundary.
 */

async function loadHeader(clientId: string) {
  const { firmId } = await requireSession();
  return getClientHeader(firmId, clientId);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await loadHeader(id);
  return { title: client?.businessName ?? "Client" };
}

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadHeader(id);

  // Another firm's client is indistinguishable from one that does not exist.
  if (!client) notFound();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/clients"
            aria-label="All clients"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-rule bg-surface text-ink-2 shadow-xs transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Icon name="chevron-left" className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[1.25rem] font-bold tracking-tight">{client.businessName}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
              <span className="figure">ABN {formatAbn(client.abn)}</span>
              <Badge tone="neutral">{ENTITY_LABELS[client.entityType]}</Badge>
              {client.gstRegistered ? (
                <Badge tone="accent">GST · {GST_BASIS_LABELS[client.gstBasis]} · BAS {BAS_FREQUENCY_LABELS[client.basFrequency].toLowerCase()}</Badge>
              ) : (
                <Badge tone="neutral">Not registered for GST</Badge>
              )}
              {client.archived ? <Badge tone="warning">Archived</Badge> : null}
            </p>
          </div>
        </div>
        <Link href={`/clients/${client.id}/journals?new=1`} className={buttonClass({ variant: "secondary", className: "rounded-full" })}>
          <Icon name="book-open" />
          Add Journal Entry
        </Link>
      </header>

      {children}
    </div>
  );
}

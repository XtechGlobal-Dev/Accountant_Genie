"use client";

/**
 * The client list: a count, a search, the archived toggle, the table.
 * Rows can be selected for a bulk archive or restore. Everything a person
 * does here is a status change — nothing is deleted.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NewClientModal } from "@/features/clients/components/new-client-modal";
import { Icon } from "@/ui/icons";
import { Avatar, Badge, Button, ButtonLink, EmptyState, cx, inputClass } from "@/ui/primitives";
import { setClientArchived } from "@/server/modules/clients/actions";
import { abn as formatAbn } from "@/shared/format";
import { ENTITY_LABELS } from "@/shared/labels";
import type { ClientRow } from "@/shared/contracts/client";

export function ClientsView({
  clients,
  showingArchived,
  openNew,
}: {
  clients: ClientRow[];
  showingArchived: boolean;
  openNew: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState(openNew);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (client) =>
        client.businessName.toLowerCase().includes(needle) ||
        (client.abn ?? "").includes(needle.replace(/\s/g, "")) ||
        (client.email ?? "").toLowerCase().includes(needle) ||
        (client.industry ?? "").toLowerCase().includes(needle),
    );
  }, [clients, query]);

  async function toggleArchive(ids: string[], archived: boolean) {
    setBusy(ids[0] ?? "bulk");
    for (const id of ids) await setClientArchived(id, archived);
    setSelected(new Set());
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const allSelected = filtered.length > 0 && filtered.every((client) => selected.has(client.id));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_minmax(0,26rem)_1fr]">
        <h1 className="text-[1.25rem] font-bold tracking-tight">
          Clients <span className="figure text-ink-2">({clients.length})</span>
        </h1>
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search clients"
            className={cx(inputClass, "h-11 rounded-full pl-11")}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selected.size > 0 ? (
            <Button variant="soft" size="sm" className="rounded-full" disabled={busy !== null} onClick={() => toggleArchive([...selected], !showingArchived)}>
              {showingArchived ? "Restore" : "Archive"} {selected.size}
            </Button>
          ) : null}
          <ButtonLink
            variant={showingArchived ? "primary" : "secondary"}
            href={showingArchived ? "/clients" : "/clients?archived=true"}
            icon="archive"
            className="rounded-full"
          >
            {showingArchived ? "Showing archived" : "Archived"}
          </ButtonLink>
          <Button icon="plus" className="rounded-full" onClick={() => setModal(true)}>
            Add Client
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        query.length > 0 ? (
          <EmptyState icon="search" title="No matching clients" body="Try a different name, ABN, email or industry." />
        ) : showingArchived ? (
          <EmptyState
            icon="archive"
            title="No archived clients"
            body="Archiving keeps a client's accounting history intact and reversible — nothing is deleted."
            action={<ButtonLink variant="secondary" className="rounded-full" href="/clients">Back to active clients</ButtonLink>}
          />
        ) : (
          <EmptyState
            icon="users"
            title="Add your first client"
            body="Add your first client to prepare reports."
            action={
              <Button icon="user-plus" size="lg" className="w-full max-w-sm rounded-full" onClick={() => setModal(true)}>
                Add New Client
              </Button>
            }
          />
        )
      ) : (
        <div className="sheet overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())}
                    className="size-4 accent-accent"
                  />
                </th>
                <th>Client Name</th>
                <th className="w-40">ABN</th>
                <th>Email</th>
                <th className="w-40">Phone Number</th>
                <th className="w-40">Business Entity</th>
                <th className="w-32">GST</th>
                <th className="w-28 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${client.businessName}`}
                      checked={selected.has(client.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(client.id);
                          else next.delete(client.id);
                          return next;
                        })
                      }
                      className="size-4 accent-accent"
                    />
                  </td>
                  <td>
                    <Link href={`/clients/${client.id}`} className="flex items-center gap-3 font-semibold text-ink transition-colors hover:text-accent">
                      <Avatar name={client.businessName} size="md" />
                      <span className="truncate">{client.businessName}</span>
                    </Link>
                  </td>
                  <td className="figure text-ink-2">{formatAbn(client.abn)}</td>
                  <td className="text-ink-2">{client.email ?? "—"}</td>
                  <td className="figure text-ink-2">{client.phone ?? "—"}</td>
                  <td className="text-ink-2">{ENTITY_LABELS[client.entityType]}</td>
                  <td>{client.gstRegistered ? <Badge tone="accent">Registered</Badge> : <Badge tone="neutral">Not registered</Badge>}</td>
                  <td className="text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={client.archived ? "undo" : "archive"}
                      disabled={busy === client.id}
                      onClick={() => toggleArchive([client.id], !client.archived)}
                    >
                      {client.archived ? "Restore" : "Archive"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewClientModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}

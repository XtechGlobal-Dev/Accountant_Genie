"use client";

/**
 * The chart of accounts, firm-wide or as one client sees it.
 *
 * System accounts are the Australian default and are read-only here: their
 * tax treatments are the advisor's to verify, not a bookkeeper's to edit.
 * Firm-created accounts can be edited or deactivated — never deleted, because
 * an account with postings is accounting history.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountActive, verifyAccountTreatment } from "@/server/modules/accounts/actions";
import type { ChartAccountRow, ChartOfAccounts } from "@/shared/contracts/account";
import type { ClientOption } from "@/shared/contracts/client";
import { ACCOUNT_SCOPE_LABELS, ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  cx,
  inputClass,
} from "@/ui/primitives";
import { AccountModal } from "./account-modal";

type Tab = "ALL" | "SYSTEM" | "CUSTOM";
type Editing = { mode: "new" } | { mode: "edit"; account: ChartAccountRow } | null;

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "ALL", label: "All accounts" },
  { id: "SYSTEM", label: "System" },
  { id: "CUSTOM", label: "Custom" },
];

/** BAS labels a treatment reports to — mirrors `basLabelsFor` on the server, for display only. */
const BAS_LABELS: Record<string, string> = {
  GST_ON_INCOME: "G1 · 1A",
  GST_FREE_INCOME: "G1",
  GST_ON_EXPENSES: "G11 · 1B",
  GST_FREE_EXPENSES: "G11",
  GST_ON_CAPITAL: "G10 · 1B",
  GST_FREE_CAPITAL: "G10",
};

export function ChartOfAccountsView({
  chart,
  clients,
  scope,
  isTaxAgent = false,
}: {
  chart: ChartOfAccounts;
  clients: ClientOption[];
  /** Present inside a client's workspace. */
  scope?: { id: string; name: string } | undefined;
  /** A registered tax agent may sign off flagged treatments. */
  isTaxAgent?: boolean | undefined;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ALL");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (row: ChartAccountRow) => {
      if (tab === "SYSTEM" && !row.isSystem) return false;
      if (tab === "CUSTOM" && row.isSystem) return false;
      if (!showInactive && !row.isActive) return false;
      if (!needle) return true;
      return (
        String(row.code).includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? "").toLowerCase().includes(needle) ||
        GST_TREATMENT_LABELS[row.gstTreatment].toLowerCase().includes(needle)
      );
    };
    return chart.groups
      .map((group) => ({ ...group, rows: group.rows.filter(matches) }))
      .filter((group) => group.rows.length > 0);
  }, [chart.groups, tab, query, showInactive]);

  const inactiveCount = chart.groups.reduce(
    (sum, group) => sum + group.rows.filter((row) => !row.isActive).length,
    0,
  );

  async function verify(row: ChartAccountRow) {
    setBusy(row.id);
    const form = new FormData();
    const note = window.prompt(`Confirm the tax treatment of ${row.code} ${row.name}. Note the source (optional):`);
    if (note === null) {
      setBusy(null);
      return;
    }
    form.set("note", note);
    await verifyAccountTreatment(row.id, form);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  async function toggleActive(row: ChartAccountRow) {
    setBusy(row.id);
    await setAccountActive(row.id, !row.isActive);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const exportHref = scope ? `/accounts/export?client=${scope.id}` : "/accounts/export";

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Account source" className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cx(
              "inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-semibold transition-colors",
              tab === item.id ? "border-accent bg-accent-soft text-accent-ink" : "border-rule bg-surface text-ink hover:border-accent/40",
            )}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto text-[13px] text-ink-3">
          {scope ? `${chart.total} accounts this client can post to` : `${chart.total} accounts`} · {chart.customCount} custom
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, code, description, etc."
            aria-label="Search accounts"
            className={cx(inputClass, "h-11 rounded-full pl-11")}
          />
        </div>
        {inactiveCount > 0 ? (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="size-4 accent-accent" />
            Show deactivated ({inactiveCount})
          </label>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink variant="secondary" icon="download" href={exportHref} prefetch={false} className="rounded-full">
            Download
          </ButtonLink>
          <Button icon="plus" className="rounded-full" onClick={() => setEditing({ mode: "new" })}>
            Add New COA
          </Button>
        </div>
      </div>

      {chart.flagged.length > 0 ? (
        <Alert
          tone="warning"
          title={`${chart.flagged.length} account${chart.flagged.length === 1 ? "" : "s"} awaiting tax advisor verification`}
        >
          <ul className="mt-1 flex flex-col gap-1.5">
            {chart.flagged.map((account) => (
              <li key={account.id} className="flex flex-wrap items-start justify-between gap-2 text-[13px] leading-relaxed">
                <span className="min-w-0">
                  <span className="code">{account.code}</span>{" "}
                  <span className="font-semibold">{account.name}</span>
                  {account.taxNote ? (
                    <span className="block font-normal opacity-80">{account.taxNote}</span>
                  ) : null}
                </span>
                {isTaxAgent ? (
                  <Button variant="secondary" size="sm" icon="shield-check" disabled={busy === account.id} onClick={() => verify(account)}>
                    Mark verified
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}


      {groups.length === 0 ? (
        <EmptyState
          icon={tab === "CUSTOM" && !query ? "table" : "search"}
          title={tab === "CUSTOM" && !query ? "No custom accounts yet" : "No matching accounts"}
          body={
            tab === "CUSTOM" && !query
              ? "The Australian default chart covers most coding. Add an account when a client needs a line the default does not have."
              : "Try a code, a name, or a tax code such as “input taxed”."
          }
          action={
            tab === "CUSTOM" && !query ? (
              <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
                Add account
              </Button>
            ) : undefined
          }
        />
      ) : (
        groups.map(({ type, rows }) => (
          <section key={type} className="sheet overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th colSpan={7} className="!normal-case">
                    <span className="text-[13px] font-semibold tracking-normal text-ink">
                      {ACCOUNT_TYPE_LABELS[type]}
                    </span>
                    <span className="figure ml-2 text-[13px] font-normal tracking-normal text-ink-3">
                      {rows.length}
                    </span>
                  </th>
                </tr>
                <tr>
                  <th className="w-20">Code</th>
                  <th className="w-64">Account</th>
                  <th>Description</th>
                  <th className="w-44">Tax code</th>
                  <th className="w-24">BAS</th>
                  <th className="w-36">Applies to</th>
                  <th className="w-40 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id} className={account.isActive ? undefined : "opacity-60"}>
                    <td className="code text-ink-2">{account.code}</td>
                    <td className="font-medium">
                      {account.name}
                      {account.requiresVerification ? (
                        <span
                          className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle"
                          title="Tax treatment awaiting advisor verification"
                        />
                      ) : null}
                      {!account.isActive ? (
                        <Badge tone="neutral" className="ml-2">
                          Deactivated
                        </Badge>
                      ) : null}
                    </td>
                    <td className="text-ink-3">{account.description ?? "—"}</td>
                    <td className="text-ink-2">{GST_TREATMENT_LABELS[account.gstTreatment]}</td>
                    <td className="code text-ink-2">{BAS_LABELS[account.gstTreatment] ?? "—"}</td>
                    <td>
                      {account.scope === "CLIENT" ? (
                        <Badge tone="accent" title={account.clientName ?? undefined}>
                          {scope ? ACCOUNT_SCOPE_LABELS.CLIENT : (account.clientName ?? "Client")}
                        </Badge>
                      ) : (
                        <Badge tone={account.scope === "SYSTEM" ? "neutral" : "outline"}>
                          {ACCOUNT_SCOPE_LABELS[account.scope]}
                        </Badge>
                      )}
                    </td>
                    <td className="text-right">
                      {account.isSystem ? null : (
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ mode: "edit", account })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === account.id}
                            onClick={() => toggleActive(account)}
                          >
                            {account.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      {editing ? (
        <AccountModal
          key={editing.mode === "edit" ? editing.account.id : "new"}
          account={editing.mode === "edit" ? editing.account : null}
          clients={clients}
          fixedClient={scope}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

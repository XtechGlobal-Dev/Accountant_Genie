"use client";

/**
 * The chart of accounts, firm-wide or as one client sees it.
 *
 * System accounts are the Australian default and are read-only here: their
 * tax treatments are the advisor's to verify, not a bookkeeper's to edit.
 * Firm-created accounts can be edited or deactivated — never deleted, because
 * an account with postings is accounting history.
 *
 * Layout: a page header with the actions, one toolbar (source, search), and
 * a register of separated rows: code, account, description, type, tax code.
 * System and custom accounts are two sections of the same register, each in
 * code order, so the whole chart reads top to bottom as one list.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountActive, verifyAccountTreatment } from "@/server/modules/accounts/actions";
import type { ChartAccountRow, ChartOfAccounts } from "@/shared/contracts/account";
import type { ClientOption } from "@/shared/contracts/client";
import { ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, cx, inputClass } from "@/ui/primitives";
import { AccountModal } from "./account-modal";

type Tab = "ALL" | "SYSTEM" | "CUSTOM";
type Editing = { mode: "new" } | { mode: "edit"; account: ChartAccountRow } | null;

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "ALL", label: "All accounts" },
  { id: "SYSTEM", label: "System accounts" },
  { id: "CUSTOM", label: "Custom accounts" },
];

/** A treatment that carries GST reads slightly stronger than one that does not. */
const GST_BEARING = new Set(["GST_ON_INCOME", "GST_ON_EXPENSES", "GST_ON_CAPITAL"]);

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

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (row: ChartAccountRow) => {
      if (!showInactive && !row.isActive) return false;
      if (!needle) return true;
      return (
        String(row.code).includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? "").toLowerCase().includes(needle) ||
        ACCOUNT_TYPE_LABELS[row.type].toLowerCase().includes(needle) ||
        GST_TREATMENT_LABELS[row.gstTreatment].toLowerCase().includes(needle)
      );
    };
    const all = chart.groups.flatMap((group) => group.rows).filter(matches).sort((a, b) => a.code - b.code);
    const system = all.filter((row) => row.isSystem);
    const custom = all.filter((row) => !row.isSystem);
    const list: { id: Tab; label: string; rows: ChartAccountRow[] }[] = [];
    if (tab !== "CUSTOM") list.push({ id: "SYSTEM", label: "System accounts", rows: system });
    if (tab !== "SYSTEM") list.push({ id: "CUSTOM", label: "Custom accounts", rows: custom });
    return list.filter((section) => section.rows.length > 0);
  }, [chart.groups, tab, query, showInactive]);

  const shown = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const inactiveCount = chart.groups.reduce(
    (sum, group) => sum + group.rows.filter((row) => !row.isActive).length,
    0,
  );
  const systemCount = chart.total - chart.customCount;

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
  const emptyCustom = tab === "CUSTOM" && !query;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={scope ? scope.name : "Firm"}
        title="Chart of Accounts"
        context={
          scope
            ? "Every account this client can post to: the Australian default chart, the firm's additions, and anything created for this client alone."
            : "The Australian default chart plus everything the firm has added. Every transaction is coded to one of these accounts, and its tax code decides where it lands on the BAS."
        }
        action={
          <>
            <ButtonLink variant="secondary" icon="download" href={exportHref} prefetch={false}>
              Download
            </ButtonLink>
            <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
              Add account
            </Button>
          </>
        }
      />

      {/* Toolbar: source · search · counts */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Account source" className="flex flex-wrap items-center gap-2">
          {TABS.map((item) => {
            const count = item.id === "ALL" ? chart.total : item.id === "SYSTEM" ? systemCount : chart.customCount;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={cx(
                  "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold transition-colors",
                  active ? "border-accent bg-accent-soft text-accent-ink" : "border-rule bg-surface text-ink hover:border-accent/40",
                )}
              >
                {item.label}
                <span className={cx("figure text-[11px]", active ? "text-accent-ink/70" : "text-ink-3")}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, code, description, type or tax code"
            aria-label="Search accounts"
            className={cx(inputClass, "h-10 rounded-full py-0 pl-10")}
          />
        </div>

        {inactiveCount > 0 ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="size-4 accent-accent" />
            Show deactivated
            <span className="figure text-ink-3">{inactiveCount}</span>
          </label>
        ) : null}

        <p className="figure ml-auto text-[13px] text-ink-3">
          {query || tab !== "ALL" ? `${shown} of ${chart.total}` : chart.total} accounts · {chart.customCount} custom
        </p>
      </div>

      {chart.flagged.length > 0 ? (
        <section className="overflow-hidden rounded-card border border-warning/40 bg-surface" aria-label="Awaiting verification">
          <div className="flex items-center gap-2.5 border-b border-warning/30 bg-warning-soft px-4 py-2.5">
            <Icon name="alert-triangle" className="size-4 shrink-0 text-warning-ink" />
            <p className="text-[13px] font-semibold text-warning-ink">
              {chart.flagged.length} tax treatment{chart.flagged.length === 1 ? "" : "s"} awaiting the registered tax advisor
            </p>
            {!isTaxAgent ? (
              <span className="ml-auto text-[12px] text-ink-3">Only a registered tax agent can mark these verified</span>
            ) : null}
          </div>
          <ul className="divide-y divide-rule-soft">
            {chart.flagged.map((account) => (
              <li key={account.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <span className="code w-12 shrink-0 pt-0.5 text-ink-2">{account.code}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">
                    {account.name}
                    <span className="ml-2 font-normal text-ink-3">{GST_TREATMENT_LABELS[account.gstTreatment]}</span>
                  </p>
                  {account.taxNote ? <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">{account.taxNote}</p> : null}
                </div>
                {isTaxAgent ? (
                  <Button variant="secondary" size="sm" icon="shield-check" disabled={busy === account.id} onClick={() => verify(account)}>
                    Mark verified
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sections.length === 0 ? (
        <EmptyState
          icon={emptyCustom ? "table" : "search"}
          title={emptyCustom ? "No custom accounts yet" : "No matching accounts"}
          body={
            emptyCustom
              ? "The Australian default chart covers most coding. Add an account when a client needs a line the default does not have."
              : "Try a code, a name, or a tax code such as “input taxed”."
          }
          action={
            emptyCustom ? (
              <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
                Add account
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="coa">
            <thead>
              <tr>
                <th className="w-24">Code</th>
                <th className="w-72">Account name</th>
                <th>Description</th>
                <th className="w-40">Type</th>
                <th className="w-56">GST treatment</th>
                <th className="w-24">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.id}>
                <tr>
                  <th scope="rowgroup" colSpan={6} className="group-row">
                    {section.label}
                    <span className="figure ml-2 font-semibold text-ink-3">{section.rows.length}</span>
                  </th>
                </tr>
                {section.rows.map((account) => (
                  <tr key={account.id} className={cx("group", !account.isActive && "opacity-55")}>
                    <td className="figure text-[13px] text-ink-2">{account.code}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-ink">{account.name}</span>
                        {account.requiresVerification ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-warning-ink"
                            title="Tax treatment awaiting advisor verification"
                          >
                            <Icon name="alert-triangle" className="size-3" />
                            Verify
                          </span>
                        ) : null}
                        {account.scope === "CLIENT" ? (
                          <Badge tone="accent" title={account.clientName ?? undefined}>
                            {scope ? "This client" : (account.clientName ?? "Client")}
                          </Badge>
                        ) : null}
                        {!account.isActive ? <Badge tone="neutral">Deactivated</Badge> : null}
                      </span>
                    </td>
                    <td className="text-[13px] leading-snug text-ink-2">{account.description ?? "—"}</td>
                    <td className="text-[13px] text-ink-2">{ACCOUNT_TYPE_LABELS[account.type]}</td>
                    <td className={cx("text-[13px]", GST_BEARING.has(account.gstTreatment) ? "text-ink" : "text-ink-2")}>
                      {GST_TREATMENT_LABELS[account.gstTreatment]}
                    </td>
                    <td className="text-right">
                      {account.isSystem ? null : (
                        <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => setEditing({ mode: "edit", account })}
                            aria-label={`Edit ${account.name}`}
                            title="Edit"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
                          >
                            <Icon name="pen" className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy === account.id}
                            onClick={() => toggleActive(account)}
                            aria-label={`${account.isActive ? "Deactivate" : "Reactivate"} ${account.name}`}
                            title={account.isActive ? "Deactivate" : "Reactivate"}
                            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50"
                          >
                            <Icon name={account.isActive ? "archive" : "undo"} className="size-3.5" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
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

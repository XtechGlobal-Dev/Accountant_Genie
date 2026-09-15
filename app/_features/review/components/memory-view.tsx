"use client";

/**
 * Coding Memory, visible and editable.
 *
 * Every rule the engine will apply is listed here with what it does and how
 * often it has fired. A learned rule the user cannot see or undo is a
 * liability, so each one can be edited or deleted in place — and the two
 * actions look like actions, not like two more columns of text.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMemoryRule, updateMemoryRule } from "@/server/modules/reconcile/actions";
import { TREATMENTS_BY_TYPE, type CreatableAccountType } from "@/shared/account-rules";
import type { AccountOption } from "@/shared/contracts/account";
import type { MemoryRuleRow } from "@/shared/contracts/transaction";
import type { AccountType, GstTreatment } from "@/shared/enums";
import { ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { shortDate } from "@/shared/format";
import { Icon } from "@/ui/icons";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  cx,
  inputClass,
} from "@/ui/primitives";

const TYPE_ORDER: AccountType[] = ["EXPENSE", "COGS", "INCOME", "ASSET", "LIABILITY", "EQUITY"];

export function MemoryView({
  rules,
  accounts,
  scope,
}: {
  rules: MemoryRuleRow[];
  /** Accounts a rule may point at. For a client page: that client's chart. */
  accounts: AccountOption[];
  scope: { clientId: string; clientName: string } | null;
}) {
  const [editing, setEditing] = useState<MemoryRuleRow | null>(null);
  const [removing, setRemoving] = useState<MemoryRuleRow | null>(null);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? rules.filter((rule) =>
            [rule.pattern, rule.accountName, String(rule.accountCode), GST_TREATMENT_LABELS[rule.gstTreatment], rule.clientName ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : rules,
    [rules, needle],
  );

  const own = scope ? visible.filter((r) => r.clientId === scope.clientId) : visible;
  const inherited = scope ? visible.filter((r) => r.clientId === null) : [];
  const fired = rules.reduce((sum, rule) => sum + rule.hitCount, 0);
  const firmWide = rules.filter((r) => r.scope === "FIRM").length;

  const table = (list: MemoryRuleRow[]) => (
    <div className="overflow-x-auto">
      <table className="coa">
        <thead>
          <tr>
            <th>Pattern</th>
            <th className="w-28">Match</th>
            {scope ? null : <th className="w-44">Applies to</th>}
            <th className="w-60">Account</th>
            <th className="w-40">Tax code</th>
            <th className="w-20 text-right">Uses</th>
            <th className="w-20 text-right">Taught</th>
            <th className="w-28">Last used</th>
            <th className="w-44 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((rule) => (
            <tr key={rule.id} className="group">
              <td>
                <span className="inline-flex items-center gap-2.5">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon name="sparkles" className="size-4" />
                  </span>
                  <span className="rounded-md bg-sunken px-2 py-1 font-mono text-[12px] text-ink">{rule.pattern}</span>
                </span>
              </td>
              <td>
                <Badge tone={rule.matchType === "EXACT" ? "accent" : "neutral"}>
                  {rule.matchType === "EXACT" ? "Exact" : "Contains"}
                </Badge>
              </td>
              {scope ? null : (
                <td>
                  {rule.scope === "FIRM" ? (
                    <Badge tone="outline">
                      <Icon name="users" className="mr-1 size-3" />
                      All clients
                    </Badge>
                  ) : (
                    <Badge tone="accent">{rule.clientName}</Badge>
                  )}
                </td>
              )}
              <td>
                <span className="flex items-center gap-2">
                  <span className="code rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2">{rule.accountCode}</span>
                  <span className="text-[13px] font-medium text-ink">{rule.accountName}</span>
                </span>
              </td>
              <td className="text-[13px] text-ink-2">{GST_TREATMENT_LABELS[rule.gstTreatment]}</td>
              <td className={cx("figure text-right text-[13px]", rule.hitCount > 0 ? "font-semibold text-ink" : "text-ink-3")}>{rule.hitCount}</td>
              <td className="figure text-right text-[13px] text-ink-2">{rule.evidenceCount}×</td>
              <td className="text-[13px] text-ink-2">
                {rule.lastUsedAt ? shortDate(rule.lastUsedAt) : <span className="text-ink-3">Not yet</span>}
              </td>
              <td className="text-right">
                <span className="inline-flex items-center gap-2">
                  <Button variant="secondary" size="sm" icon="pen" onClick={() => setEditing(rule)}>
                    Edit
                  </Button>
                  <button
                    type="button"
                    onClick={() => setRemoving(rule)}
                    aria-label={`Delete rule ${rule.pattern}`}
                    title="Delete"
                    className="inline-flex size-9 items-center justify-center rounded-xl border border-rule bg-surface text-ink-2 shadow-xs transition-colors hover:border-negative/40 hover:bg-negative-soft hover:text-negative-ink"
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const noMatches = (
    <p className="rounded-2xl border border-dashed border-rule px-5 py-8 text-center text-sm text-ink-3">
      No rules match “{query.trim()}”.
    </p>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Coding Memory"
        context={
          scope
            ? `What the firm has taught the engine about ${scope.clientName}, plus the rules that apply to every client.`
            : "Every rule the firm has taught the engine. Client rules win over firm-wide ones."
        }
        action={
          rules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Stat icon="sparkles" label="Rules" value={rules.length} />
              <Stat icon="zap" label="Times applied" value={fired} />
              {scope ? null : <Stat icon="users" label="Firm-wide" value={firmWide} />}
            </div>
          ) : null
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="Nothing learned yet"
          body="Recode a transaction and choose “Remember” — the next time that merchant appears, it is coded the same way before any AI call."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by pattern, account or tax code"
                aria-label="Search rules"
                className={cx(inputClass, "h-10 rounded-full py-0 pl-10")}
              />
            </div>
            <p className="figure ml-auto text-[13px] text-ink-3">
              {needle ? `${visible.length} of ${rules.length}` : rules.length} rule{rules.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent-soft/40 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
            <Icon name="info" className="mt-0.5 size-4 shrink-0 text-accent" />
            <p>
              Memory runs first, before rules and before any AI call. A matching pattern codes the transaction to this account and
              tax code straight away, and the accountant still sees it on the review screen.
            </p>
          </div>

          {scope ? (
            <>
              <section className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  This client
                  <Badge tone="neutral" className="figure">
                    {own.length}
                  </Badge>
                </h2>
                {own.length === 0 ? (
                  needle ? noMatches : <p className="text-sm text-ink-3">No client-specific rules yet.</p>
                ) : (
                  table(own)
                )}
              </section>
              {inherited.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    Every client
                    <Badge tone="neutral" className="figure">
                      {inherited.length}
                    </Badge>
                  </h2>
                  {table(inherited)}
                </section>
              ) : null}
            </>
          ) : visible.length === 0 ? (
            noMatches
          ) : (
            table(visible)
          )}
        </>
      )}

      {editing ? (
        <EditRuleModal
          key={editing.id}
          rule={editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? <DeleteRuleModal key={removing.id} rule={removing} onClose={() => setRemoving(null)} /> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: "sparkles" | "zap" | "users"; label: string; value: number }) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full border border-rule bg-surface px-3.5 text-[13px] shadow-xs">
      <Icon name={icon} className="size-3.5 text-accent" />
      <span className="text-ink-2">{label}</span>
      <span className="figure font-semibold text-ink">{value}</span>
    </span>
  );
}

function RuleSummary({ rule }: { rule: MemoryRuleRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-rule bg-sunken/60 p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-surface px-2 py-1 font-mono text-[12px] text-ink ring-1 ring-rule">{rule.pattern}</span>
        <Badge tone={rule.matchType === "EXACT" ? "accent" : "neutral"}>{rule.matchType === "EXACT" ? "Exact" : "Contains"}</Badge>
      </div>
      <p className="text-ink-2">
        Codes to <span className="code text-ink-3">{rule.accountCode}</span>{" "}
        <span className="font-medium text-ink">{rule.accountName}</span> as {GST_TREATMENT_LABELS[rule.gstTreatment]}. Applied{" "}
        <span className="figure font-medium text-ink">{rule.hitCount}</span> time{rule.hitCount === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function DeleteRuleModal({ rule, onClose }: { rule: MemoryRuleRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteMemoryRule(rule.id);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon="trash"
      title="Delete this rule?"
      description="Transactions already coded by it are not changed. From the next run the engine falls back to rules and AI for this pattern."
    >
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        {error ? <Alert tone="negative">{error}</Alert> : null}
        <RuleSummary rule={rule} />
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Keep rule
        </Button>
        <Button variant="danger" icon="trash" onClick={confirm} disabled={pending}>
          {pending ? "Deleting…" : "Delete rule"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function EditRuleModal({
  rule,
  accounts,
  onClose,
}: {
  rule: MemoryRuleRow;
  accounts: AccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [pattern, setPattern] = useState(rule.pattern);
  const [matchType, setMatchType] = useState<"EXACT" | "CONTAINS">(rule.matchType);
  const [accountId, setAccountId] = useState(rule.accountId);
  const [treatment, setTreatment] = useState<GstTreatment>(rule.gstTreatment);

  const account = accounts.find((a) => a.id === accountId);
  const allowed = account && account.type !== "UNKNOWN" ? TREATMENTS_BY_TYPE[account.type as CreatableAccountType] : [];
  const grouped = TYPE_ORDER.map((type) => ({ type, accounts: accounts.filter((a) => a.type === type) })).filter((g) => g.accounts.length > 0);

  function submit() {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = await updateMemoryRule(rule.id, { pattern, matchType, accountId, gstTreatment: treatment });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon="sparkles"
      title="Edit rule"
      description="Applies from the next reconciliation run. Transactions already accepted are not changed."
      size="lg"
    >
      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
        {error && !field ? <Alert tone="negative">{error}</Alert> : null}

        <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            <Icon name="search" className="size-3.5" />
            When the description
          </h3>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Select label="Match" name="matchType" value={matchType} onChange={(event) => setMatchType(event.target.value as "EXACT" | "CONTAINS")}>
              <option value="EXACT">Is exactly</option>
              <option value="CONTAINS">Contains</option>
            </Select>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-pattern" className="text-[13px] font-semibold text-ink">
                Pattern
              </label>
              <input
                id="rule-pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                maxLength={200}
                className={cx(inputClass, "font-mono text-xs")}
                aria-invalid={field === "pattern" || undefined}
              />
              {field === "pattern" && error ? (
                <p className="text-xs font-medium text-negative-ink">{error}</p>
              ) : (
                <p className="text-xs text-ink-3">Matched against the bank description, ignoring case.</p>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            <Icon name="book-open" className="size-3.5" />
            Code it to
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Account"
              name="accountId"
              icon="book-open"
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                const next = accounts.find((a) => a.id === event.target.value);
                if (next && next.type !== "UNKNOWN") {
                  const options = TREATMENTS_BY_TYPE[next.type as CreatableAccountType];
                  if (!options.includes(treatment)) setTreatment(next.gstTreatment);
                }
              }}
              error={field === "accountId" ? (error ?? undefined) : undefined}
            >
              {grouped.map((group) => (
                <optgroup key={group.type} label={ACCOUNT_TYPE_LABELS[group.type]}>
                  {group.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select
              label="Tax code"
              name="gstTreatment"
              icon="percent"
              value={treatment}
              onChange={(event) => setTreatment(event.target.value as GstTreatment)}
              error={field === "gstTreatment" ? (error ?? undefined) : undefined}
            >
              {allowed.map((t) => (
                <option key={t} value={t}>
                  {GST_TREATMENT_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
        </section>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button icon="save" onClick={submit} disabled={pending || pattern.trim().length < 2}>
          {pending ? "Saving…" : "Save rule"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

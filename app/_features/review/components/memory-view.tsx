"use client";

/**
 * Coding Memory, visible and editable.
 *
 * Every rule the engine will apply is listed here with what it does and how
 * often it has fired. A learned rule the user cannot see or undo is a
 * liability, so each one can be edited or deleted in place.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMemoryRule, updateMemoryRule } from "@/server/modules/reconcile/actions";
import { TREATMENTS_BY_TYPE, type CreatableAccountType } from "@/shared/account-rules";
import type { AccountOption } from "@/shared/contracts/account";
import type { MemoryRuleRow } from "@/shared/contracts/transaction";
import type { AccountType, GstTreatment } from "@/shared/enums";
import { ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { shortDate } from "@/shared/format";
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
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<MemoryRuleRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(rule: MemoryRuleRow) {
    setBusy(rule.id);
    setError(null);
    const result = await deleteMemoryRule(rule.id);
    if (!result.ok) setError(result.error);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const own = scope ? rules.filter((r) => r.clientId === scope.clientId) : rules;
  const inherited = scope ? rules.filter((r) => r.clientId === null) : [];

  const table = (list: MemoryRuleRow[]) => (
    <div className="sheet overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th className="w-28">Match</th>
            {scope ? null : <th className="w-48">Applies to</th>}
            <th className="w-64">Account</th>
            <th className="w-40">Tax code</th>
            <th className="w-20 text-right">Uses</th>
            <th className="w-24 text-right">Taught</th>
            <th className="w-28">Last used</th>
            <th className="w-36 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((rule) => (
            <tr key={rule.id}>
              <td className="font-mono text-xs">{rule.pattern}</td>
              <td className="text-ink-2">{rule.matchType === "EXACT" ? "exactly" : "contains"}</td>
              {scope ? null : (
                <td>
                  {rule.scope === "FIRM" ? (
                    <Badge tone="outline">All clients</Badge>
                  ) : (
                    <Badge tone="accent">{rule.clientName}</Badge>
                  )}
                </td>
              )}
              <td>
                <span className="code mr-1.5 text-ink-3">{rule.accountCode}</span>
                {rule.accountName}
              </td>
              <td className="text-ink-2">{GST_TREATMENT_LABELS[rule.gstTreatment]}</td>
              <td className="figure text-right text-ink-2">{rule.hitCount}</td>
              <td className="figure text-right text-ink-2">{rule.evidenceCount}×</td>
              <td className="text-ink-2">{rule.lastUsedAt ? shortDate(rule.lastUsedAt) : "—"}</td>
              <td className="text-right">
                <span className="inline-flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(rule)} disabled={busy === rule.id}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(rule)} disabled={busy === rule.id}>
                    Delete
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      />
      {error ? <Alert tone="negative">{error}</Alert> : null}

      {rules.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="Nothing learned yet"
          body="Recode a transaction and choose “Remember” — the next time that merchant appears, it is coded the same way before any AI call."
        />
      ) : scope ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink-2">
              This client <span className="figure font-normal text-ink-3">{own.length}</span>
            </h2>
            {own.length === 0 ? (
              <p className="text-sm text-ink-3">No client-specific rules yet.</p>
            ) : (
              table(own)
            )}
          </section>
          {inherited.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-ink-2">
                Every client <span className="figure font-normal text-ink-3">{inherited.length}</span>
              </h2>
              {table(inherited)}
            </section>
          ) : null}
        </>
      ) : (
        table(rules)
      )}

      {editing ? (
        <EditRuleModal
          key={editing.id}
          rule={editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
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
    <Modal open onClose={onClose} title="Edit rule" description="Applies from the next reconciliation run. Transactions already accepted are not changed." size="lg">
      <div className="flex flex-col gap-4 px-5 py-5">
        {error && !field ? <Alert tone="negative">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-pattern" className="text-sm font-medium text-ink">
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
            {field === "pattern" && error ? <p className="text-xs font-medium text-negative-ink">{error}</p> : null}
          </div>
          <Select label="Match" name="matchType" value={matchType} onChange={(event) => setMatchType(event.target.value as "EXACT" | "CONTAINS")}>
            <option value="EXACT">exactly</option>
            <option value="CONTAINS">contains</option>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Account"
            name="accountId"
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
          <Select label="Tax code" name="gstTreatment" value={treatment} onChange={(event) => setTreatment(event.target.value as GstTreatment)} error={field === "gstTreatment" ? (error ?? undefined) : undefined}>
            {allowed.map((t) => (
              <option key={t} value={t}>
                {GST_TREATMENT_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || pattern.trim().length < 2}>
          {pending ? "Saving…" : "Save rule"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

"use client";

/**
 * Recode one transaction, and optionally teach Coding Memory.
 *
 * Three memory choices, exactly: remember for this client, remember for every
 * client, or don't. The pattern the rule will match on is shown and editable
 * so a person can see what they are teaching before they teach it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recodeTransaction } from "@/server/modules/reconcile/actions";
import { TREATMENTS_BY_TYPE, type CreatableAccountType } from "@/shared/account-rules";
import type { AccountOption } from "@/shared/contracts/account";
import type { TransactionRow } from "@/shared/contracts/transaction";
import type { AccountType, GstTreatment } from "@/shared/enums";
import { ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { Alert, Button, Modal, ModalFooter, Money, Select, cx, inputClass } from "@/ui/primitives";

const TYPE_ORDER: AccountType[] = ["EXPENSE", "COGS", "INCOME", "ASSET", "LIABILITY", "EQUITY"];

type Remember = "NONE" | "CLIENT" | "FIRM";

export function RecodeModal({
  clientId,
  transaction,
  accounts,
  subcontractors,
  loans,
  onClose,
}: {
  clientId: string;
  transaction: TransactionRow;
  accounts: readonly AccountOption[];
  subcontractors: ReadonlyArray<{ id: string; name: string }>;
  loans: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(transaction.accountId ?? "");
  const [treatment, setTreatment] = useState<GstTreatment | "">(
    transaction.gstTreatment && transaction.gstTreatment !== "UNALLOCATED" ? transaction.gstTreatment : "",
  );
  const [remember, setRemember] = useState<Remember>("NONE");
  const [pattern, setPattern] = useState(transaction.normalised);
  const [matchType, setMatchType] = useState<"EXACT" | "CONTAINS">("EXACT");
  const [subcontractorId, setSubcontractorId] = useState(transaction.subcontractorId ?? "");
  const [loanId, setLoanId] = useState(transaction.loanId ?? "");

  const account = accounts.find((a) => a.id === accountId);
  const allowed =
    account && account.type !== "UNKNOWN" ? TREATMENTS_BY_TYPE[account.type as CreatableAccountType] : [];
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  })).filter((g) => g.accounts.length > 0);

  function submit() {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = await recodeTransaction(clientId, transaction.id, {
        accountId,
        gstTreatment: treatment || undefined,
        remember,
        pattern: remember === "NONE" ? undefined : pattern,
        matchType,
        subcontractorId: subcontractorId || undefined,
        loanId: loanId || undefined,
        // The row version the screen showed: a stale edit is refused, not merged.
        version: transaction.version,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }

  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title="Recode transaction"
      description="GST is recomputed from the tax code you choose. Nothing posts until the transaction is accepted."
      size="lg"
    >
      <div className="flex flex-col gap-5 px-5 py-5">
        {error && !field ? <Alert tone="negative">{error}</Alert> : null}

        <div className="flex items-start justify-between gap-4 rounded-2xl border border-rule bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{transaction.description}</p>
            <p className="mt-0.5 text-xs text-ink-3">
              {transaction.bankAccountName}
              {transaction.reasoning ? ` · ${transaction.reasoning}` : ""}
            </p>
          </div>
          <Money cents={transaction.amountCents} emphasis />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Account"
            name="accountId"
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              setTreatment("");
            }}
            error={errorFor("accountId")}
          >
            <option value="">Choose an account…</option>
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
            value={treatment}
            onChange={(event) => setTreatment(event.target.value as GstTreatment | "")}
            disabled={!account}
            error={errorFor("gstTreatment")}
            hint={account ? `Account default: ${GST_TREATMENT_LABELS[account.gstTreatment]}` : undefined}
          >
            <option value="">Use the account&rsquo;s tax code</option>
            {allowed.map((t) => (
              <option key={t} value={t}>
                {GST_TREATMENT_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>

        {subcontractors.length > 0 ? (
          <Select
            label="Subcontractor"
            name="subcontractorId"
            value={subcontractorId}
            onChange={(event) => setSubcontractorId(event.target.value)}
            hint="Link a payment to a subcontractor so it reaches the TPAR."
          >
            <option value="">Not a subcontractor payment</option>
            {subcontractors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : null}

        {loans.length > 0 && account?.type === "LIABILITY" ? (
          <Select
            label="Loan facility"
            name="loanId"
            value={loanId}
            onChange={(event) => setLoanId(event.target.value)}
            hint="A repayment linked to a loan is split into principal and interest from the loan's schedule when it is accepted — never expensed whole."
          >
            <option value="">Not a loan repayment</option>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">Coding Memory</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["NONE", "Don't remember", "Just this transaction."],
                ["CLIENT", "Remember for this client", "Future matches for this client code the same way."],
                ["FIRM", "Remember for every client", "Every client of the firm codes it the same way."],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={remember === value}
                onClick={() => setRemember(value)}
                className={cx(
                  "rounded-control border px-3 py-2.5 text-left transition-colors",
                  remember === value
                    ? "border-accent bg-accent-soft"
                    : "border-rule bg-surface hover:border-rule-strong",
                )}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{hint}</span>
              </button>
            ))}
          </div>
          {remember !== "NONE" ? (
            <div className="grid gap-3 rounded-2xl border border-rule bg-surface-2 p-3 sm:grid-cols-[1fr_10rem]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="memory-pattern" className="text-xs font-medium text-ink-2">
                  Matches descriptions that…
                </label>
                <input
                  id="memory-pattern"
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                  maxLength={200}
                  className={cx(inputClass, "font-mono text-xs")}
                  aria-invalid={field === "pattern" || undefined}
                />
                {field === "pattern" && error ? (
                  <p className="text-xs font-medium text-negative-ink">{error}</p>
                ) : null}
              </div>
              <Select
                name="matchType"
                aria-label="Match type"
                value={matchType}
                onChange={(event) => setMatchType(event.target.value as "EXACT" | "CONTAINS")}
              >
                <option value="EXACT">exactly equal</option>
                <option value="CONTAINS">contain this</option>
              </Select>
              <p className="text-xs leading-relaxed text-ink-3 sm:col-span-2">
                Other open transactions matching this rule are recoded straight away. You can edit
                or delete the rule under Coding Memory at any time.
              </p>
            </div>
          ) : null}
        </fieldset>
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !accountId || (remember !== "NONE" && pattern.trim().length < 2)}>
          {pending ? "Saving…" : "Save coding"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

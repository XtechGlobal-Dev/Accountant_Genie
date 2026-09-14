"use client";

/**
 * Post a manual journal, or a client's opening balances.
 *
 * The form keeps amounts as typed strings and converts them to integer cents
 * with `parseCents` for every calculation; nothing here is ever a float. GST
 * on a line is a preview only: the server recomputes it from the account's
 * treatment and the client's registration, and never reads it from the form.
 *
 * "Post" stays disabled until the journal balances. Debits equal credits is
 * not a warning in a ledger, it is the definition of a journal.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postJournal } from "@/server/modules/ledger/actions";
import { gstComponentCents } from "@/shared/gst-math";
import { parseCents } from "@/shared/money";
import type { AccountOption } from "@/shared/contracts/account";
import type { JournalInput } from "@/shared/contracts/journal";
import type { AccountType } from "@/shared/enums";
import { ACCOUNT_TYPE_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
import { Alert, Button, Modal, ModalFooter, Money, Select, cx, inputClass } from "@/ui/primitives";

interface LineDraft {
  key: number;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
  subcontractorId: string;
}

/** The system account whose lines feed the TPAR. */
const SUBCONTRACTOR_CODE = 320;

const TYPE_ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "COGS", "EXPENSE"];

let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  accountId: "",
  description: "",
  debit: "",
  credit: "",
  subcontractorId: "",
});

/** Today in Sydney as YYYY-MM-DD — what a date input wants. */
function todayInput(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Cents from a typed amount: 0 when blank, null when unparseable. */
function centsOf(value: string): number | null {
  if (value.trim() === "") return 0;
  const cents = parseCents(value);
  return cents === null || cents < 0 ? null : cents;
}

export function JournalModal({
  clientId,
  accounts,
  mode,
  financialYears,
  subcontractors = [],
  onClose,
}: {
  clientId: string;
  accounts: readonly AccountOption[];
  mode: "MANUAL" | "OPENING";
  /** Years ending 30 June, newest first — for the opening-balance picker. */
  financialYears: readonly number[];
  subcontractors?: ReadonlyArray<{ id: string; name: string }> | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const defaultFy = financialYears[0] ?? new Date().getUTCFullYear();
  const [fy, setFy] = useState<number>(defaultFy);
  const [date, setDate] = useState<string>(mode === "OPENING" ? `${defaultFy - 1}-07-01` : todayInput());
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState(
    mode === "OPENING" ? `Opening balances FY${defaultFy}` : "",
  );
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine(), blankLine()]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const grouped = useMemo(
    () =>
      TYPE_ORDER.map((type) => ({
        type,
        accounts: accounts.filter((a) => a.type === type),
      })).filter((group) => group.accounts.length > 0),
    [accounts],
  );

  // Everything derived from the drafts, in cents.
  const computed = lines.map((line) => {
    const debitCents = centsOf(line.debit);
    const creditCents = centsOf(line.credit);
    const account = accountById.get(line.accountId);
    const invalid = debitCents === null || creditCents === null;
    const amount = invalid ? 0 : Math.max(debitCents ?? 0, creditCents ?? 0);
    const gstCents = account?.gstBearing ? gstComponentCents(amount) : 0;
    return {
      debitCents: debitCents ?? 0,
      creditCents: creditCents ?? 0,
      invalid,
      account,
      gstCents,
      netCents: amount - gstCents,
      complete:
        !invalid &&
        account !== undefined &&
        (debitCents ?? 0) + (creditCents ?? 0) > 0 &&
        !((debitCents ?? 0) > 0 && (creditCents ?? 0) > 0),
    };
  });
  const totalDebits = computed.reduce((sum, c) => sum + c.debitCents, 0);
  const totalCredits = computed.reduce((sum, c) => sum + c.creditCents, 0);
  const difference = totalDebits - totalCredits;
  const balanced = difference === 0 && totalDebits > 0;
  const canPost =
    balanced && lines.length >= 2 && computed.every((c) => c.complete) && date !== "";

  function update(key: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // One side per line. Typing on one side clears the other.
        if (patch.debit !== undefined && patch.debit !== "") next.credit = "";
        if (patch.credit !== undefined && patch.credit !== "") next.debit = "";
        return next;
      }),
    );
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 2 ? current.filter((l) => l.key !== key) : current));
  }

  function changeFy(next: number) {
    setFy(next);
    setDate(`${next - 1}-07-01`);
    setDescription((current) =>
      /^Opening balances FY\d{4}$/.test(current) ? `Opening balances FY${next}` : current,
    );
  }

  function submit() {
    setError(null);
    setErrorField(null);
    const payload: JournalInput = {
      date,
      reference: reference.trim() || undefined,
      description: description.trim() || undefined,
      source: mode,
      lines: lines.map((line, index) => ({
        accountId: line.accountId,
        description: line.description.trim() || undefined,
        debitCents: computed[index]!.debitCents,
        creditCents: computed[index]!.creditCents,
        subcontractorId: line.subcontractorId || undefined,
      })),
    };
    startTransition(async () => {
      const result = await postJournal(clientId, payload);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setErrorField(result.field ?? null);
      }
    });
  }

  const errorLine = errorField?.startsWith("lines.")
    ? Number(errorField.slice("lines.".length))
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "OPENING" ? "Opening balances" : "New journal entry"}
      description={
        mode === "OPENING"
          ? "A real journal dated 1 July, posted once per financial year. Enter the balances the year starts with."
          : "Posted entries cannot be edited. To correct one, reverse it and post again."
      }
      size="xl"
    >
      <div className="flex flex-col gap-5 px-5 py-5">
        {error ? <Alert tone="negative">{error}</Alert> : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="rounded-2xl border border-rule bg-surface p-4 shadow-xs">
            <p className="mb-3 text-[15px] font-bold">Journal Details</p>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_2fr]">
          {mode === "OPENING" ? (
            <Select
              label="Financial year"
              name="fy"
              value={String(fy)}
              onChange={(event) => changeFy(Number(event.target.value))}
              hint={`Dated 1 July ${fy - 1}`}
            >
              {financialYears.map((year) => (
                <option key={year} value={year}>
                  FY{year}
                </option>
              ))}
            </Select>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="journal-date" className="text-sm font-medium text-ink">
                Date
              </label>
              <input
                id="journal-date"
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-invalid={errorField === "date" || undefined}
                className={inputClass}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="journal-reference" className="text-sm font-medium text-ink">
              Reference <span className="font-normal text-ink-3">optional</span>
            </label>
            <input
              id="journal-reference"
              value={reference}
              maxLength={60}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. ADJ-14"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="journal-description" className="text-sm font-medium text-ink">
              Description <span className="font-normal text-ink-3">optional</span>
            </label>
            <input
              id="journal-description"
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this journal records"
              className={inputClass}
            />
          </div>
            </div>
          </div>
          <dl className="flex flex-col justify-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft/60 px-5 py-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Total Debits:</dt>
              <dd><Money cents={totalDebits} emphasis /></dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Total Credits:</dt>
              <dd><Money cents={totalCredits} emphasis /></dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">Total Tax:</dt>
              <dd><Money cents={computed.reduce((sum, c) => sum + (c.account?.gstBearing ? c.gstCents : 0), 0)} emphasis /></dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-accent/20 pt-3">
              <dt className="font-semibold text-ink">Entry balance:</dt>
              <dd className={cx(difference === 0 ? "text-positive-ink" : "text-warning-ink")}><Money cents={Math.abs(difference)} emphasis /></dd>
            </div>
          </dl>
        </div>

        <p className="text-[15px] font-bold">Journal Lines</p>
        <div className="overflow-x-auto rounded-2xl border border-rule">
          <table className="w-full min-w-[56rem] border-collapse">
            <thead>
              <tr className="bg-surface-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                <th className="w-[19rem] px-3 py-2.5 text-left">Account</th>
                <th className="px-3 py-2.5 text-left">Description</th>
                <th className="w-32 px-3 py-2.5 text-right">Debit</th>
                <th className="w-32 px-3 py-2.5 text-right">Credit</th>
                <th className="w-24 px-3 py-2.5 text-right">GST</th>
                <th className="w-28 px-3 py-2.5 text-right">Net</th>
                <th className="w-10 px-1 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const c = computed[index]!;
                const flagged = errorLine === index;
                return (
                  <tr
                    key={line.key}
                    className={cx("border-t border-rule-soft", flagged && "bg-negative-soft")}
                  >
                    <td className="px-2 py-1.5">
                      <select
                        value={line.accountId}
                        onChange={(event) => update(line.key, { accountId: event.target.value })}
                        aria-label={`Line ${index + 1} account`}
                        className={cx(inputClass, "h-10 py-1.5")}
                      >
                        <option value="">Choose an account…</option>
                        {grouped.map((group) => (
                          <optgroup key={group.type} label={ACCOUNT_TYPE_LABELS[group.type]}>
                            {group.accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} · {account.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.description}
                        maxLength={300}
                        onChange={(event) => update(line.key, { description: event.target.value })}
                        placeholder="Line description"
                        aria-label={`Line ${index + 1} description`}
                        className={cx(inputClass, "h-10 py-1.5")}
                      />
                      {c.account?.code === SUBCONTRACTOR_CODE && subcontractors.length > 0 ? (
                        <select
                          value={line.subcontractorId}
                          onChange={(event) => update(line.key, { subcontractorId: event.target.value })}
                          aria-label={`Line ${index + 1} subcontractor`}
                          className={cx(inputClass, "mt-1 h-9 py-1 text-xs")}
                        >
                          <option value="">Subcontractor for the TPAR…</option>
                          {subcontractors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.debit}
                        inputMode="decimal"
                        onChange={(event) => update(line.key, { debit: event.target.value })}
                        placeholder="0.00"
                        aria-label={`Line ${index + 1} debit`}
                        aria-invalid={c.invalid || undefined}
                        className={cx(inputClass, "figure h-10 py-1.5 text-right")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.credit}
                        inputMode="decimal"
                        onChange={(event) => update(line.key, { credit: event.target.value })}
                        placeholder="0.00"
                        aria-label={`Line ${index + 1} credit`}
                        aria-invalid={c.invalid || undefined}
                        className={cx(inputClass, "figure h-10 py-1.5 text-right")}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-2">
                      {c.account?.gstBearing ? <Money cents={c.gstCents} /> : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-2">
                      {c.account ? <Money cents={c.netCents} /> : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length <= 2}
                        aria-label={`Remove line ${index + 1}`}
                        className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-negative disabled:opacity-30"
                      >
                        <Icon name="trash" className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-rule bg-surface-2 text-sm font-semibold">
                <td className="px-3 py-2.5 text-ink-2" colSpan={2}>
                  Totals
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Money cents={totalDebits} emphasis />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Money cents={totalCredits} emphasis />
                </td>
                <td className="px-3 py-2.5 text-right" colSpan={3}>
                  {balanced ? (
                    <span className="inline-flex items-center gap-1.5 text-positive-ink">
                      <Icon name="check-circle" className="size-4" /> Balanced
                    </span>
                  ) : (
                    <span className={cx("inline-flex items-center gap-1.5", totalDebits + totalCredits > 0 ? "text-warning-ink" : "text-ink-3")}>
                      Out of balance by <Money cents={Math.abs(difference)} />
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <Button variant="secondary" size="sm" icon="plus" className="rounded-full" onClick={() => setLines((current) => [...current, blankLine()])}>
            Journal Line
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-ink-3">
          GST is previewed from each account&rsquo;s tax code as gross ÷ 11 and is recomputed on the
          server when the journal posts. Lines to accounts with no GST show a dash.
        </p>
      </div>

      <ModalFooter
        note={
          canPost ? undefined : "Every line needs an account and one amount, and debits must equal credits."
        }
      >
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canPost || pending} icon="check">
          {pending ? "Posting…" : "Post Journal"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

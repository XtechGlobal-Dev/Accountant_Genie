"use client";

/**
 * The review screen: every bank transaction for a client, dense, keyboard-first.
 *
 *   ↑/↓ or J/K  move        A  accept the row       E  recode
 *   Space       select      X  exclude              N  next needing review
 *   Shift+A     accept all selected
 *
 * Accepting posts the journal. Nothing else on this screen touches the ledger.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  acceptTransactions,
  excludeTransaction,
  reopenTransaction,
  restoreTransaction,
  runReconciliation,
} from "@/server/modules/reconcile/actions";
import type { AccountOption } from "@/shared/contracts/account";
import type { ReviewSummary, TransactionRow } from "@/shared/contracts/transaction";
import { shortDate } from "@/shared/format";
import { GST_TREATMENT_LABELS } from "@/shared/labels";
import { UploadStatementModal } from "@/features/banking/components/upload-statement-modal";
import { Icon } from "@/ui/icons";
import {
  Alert,
  Badge,
  Button,
  ConfidenceRail,
  EmptyState,
  Kbd,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  buttonClass,
  cx,
  inputClass,
} from "@/ui/primitives";
import { RecodeModal } from "./recode-modal";

type Filter = "review" | "coded" | "reviewed" | "excluded" | "pending" | "all";

const SOURCE_LABELS: Record<string, string> = {
  RULE: "Rule",
  MEMORY: "Memory",
  AI: "AI",
  MANUAL: "Manual",
};

function confidenceLevel(row: TransactionRow): string | null {
  if (row.status !== "CLASSIFIED" || row.excludedAt) return null;
  if (row.source === "RULE" || row.source === "MEMORY" || row.source === "MANUAL") return "CERTAIN";
  if (row.gstTreatment === "UNALLOCATED" || (row.confidence ?? 0) < 0.8) return "LOW";
  if (row.needsReview) return "MEDIUM";
  return "HIGH";
}

function matchesFilter(row: TransactionRow, filter: Filter): boolean {
  switch (filter) {
    case "excluded":
      return row.excludedAt !== null;
    case "pending":
      return !row.excludedAt && row.status === "PENDING";
    case "review":
      return !row.excludedAt && row.status === "CLASSIFIED" && row.needsReview;
    case "coded":
      return !row.excludedAt && row.status === "CLASSIFIED" && !row.needsReview;
    case "reviewed":
      return !row.excludedAt && row.status === "REVIEWED";
    default:
      return true;
  }
}

export function ReviewView({
  clientId,
  clientName,
  rows,
  summary,
  accounts,
  subcontractors,
  bankAccounts,
}: {
  clientId: string;
  clientName: string;
  rows: TransactionRow[];
  summary: ReviewSummary;
  accounts: AccountOption[];
  subcontractors: { id: string; name: string }[];
  bankAccounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>(summary.needsReview > 0 ? "review" : summary.coded > 0 ? "coded" : "all");
  const [bankAccountId, setBankAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [recode, setRecode] = useState<TransactionRow | null>(null);
  const [exclude, setExclude] = useState<TransactionRow | null>(null);
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "positive" | "warning" | "negative"; text: string } | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        matchesFilter(row, filter) &&
        (!bankAccountId || row.bankAccountId === bankAccountId) &&
        (!needle ||
          row.description.toLowerCase().includes(needle) ||
          (row.accountName ?? "").toLowerCase().includes(needle) ||
          String(row.accountCode ?? "").includes(needle)),
    );
  }, [rows, filter, bankAccountId, query]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  const current = visible[cursor];

  async function run<T>(work: () => Promise<T>, after?: (result: T) => void) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      after?.(result);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const accept = (ids: string[]) =>
    run(
      () => acceptTransactions(clientId, ids),
      (result) => {
        if (!result.ok) {
          setNotice({ tone: "negative", text: result.error });
          return;
        }
        setSelected(new Set());
        const skipped = result.skipped.length;
        setNotice({
          tone: skipped > 0 ? "warning" : "positive",
          text:
            `${result.accepted} accepted and posted` +
            (skipped > 0 ? ` · ${skipped} skipped: ${result.skipped.map((s) => s.reason).filter((v, i, a) => a.indexOf(v) === i).join("; ")}` : ""),
        });
      },
    );

  const reconcile = () =>
    run(
      () => runReconciliation(clientId),
      (result) => {
        if (!result.ok) {
          setNotice({ tone: "negative", text: result.error });
          return;
        }
        const s = result.stats;
        setNotice({
          tone: s.aiFailure ? "warning" : "positive",
          text:
            `${s.processed} coded — ${s.byMemory} by memory, ${s.byRule} by rules, ${s.byAi} by AI; ${s.needsReview} need a look` +
            (s.aiFailure ? ` · AI tier: ${s.aiFailure}` : ""),
        });
      },
    );

  const canAccept = (row: TransactionRow | undefined) =>
    row !== undefined &&
    !row.excludedAt &&
    row.status === "CLASSIFIED" &&
    row.accountId !== null &&
    row.gstTreatment !== null &&
    row.gstTreatment !== "UNALLOCATED";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (recode || exclude || upload || busy) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          setCursor((c) => Math.min(c + 1, visible.length - 1));
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case " ":
          event.preventDefault();
          if (current) {
            setSelected((s) => {
              const next = new Set(s);
              if (next.has(current.id)) next.delete(current.id);
              else next.add(current.id);
              return next;
            });
          }
          break;
        case "a":
          if (current && canAccept(current)) void accept([current.id]);
          break;
        case "A":
          if (selected.size > 0) void accept([...selected]);
          break;
        case "e":
          if (current && current.status !== "REVIEWED" && !current.excludedAt) setRecode(current);
          break;
        case "x":
          if (current && current.status !== "REVIEWED" && !current.excludedAt) setExclude(current);
          break;
        case "n": {
          const next = visible.findIndex((row, i) => i > cursor && row.needsReview && row.status === "CLASSIFIED" && !row.excludedAt);
          if (next !== -1) setCursor(next);
          break;
        }
        case "Escape":
          setSelected(new Set());
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const acceptableCoded = rows.filter((row) => matchesFilter(row, "coded") && canAccept(row)).map((row) => row.id);

  const chips: ReadonlyArray<{ id: Filter; label: string; count: number; tone?: "warning" | "accent" }> = [
    { id: "review", label: "Needs review", count: summary.needsReview, tone: "warning" },
    { id: "coded", label: "Ready to accept", count: summary.coded, tone: "accent" },
    { id: "reviewed", label: "Accepted", count: summary.reviewed },
    { id: "pending", label: "Not coded", count: summary.notCoded },
    { id: "excluded", label: "Excluded", count: summary.excluded },
    { id: "all", label: "All", count: summary.total },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Transactions"
        context={`${summary.total.toLocaleString("en-AU")} imported · ${summary.needsReview.toLocaleString("en-AU")} need a look · ${summary.reviewed.toLocaleString("en-AU")} accepted`}
        action={
          <>
            {summary.notCoded > 0 ? (
              <Button variant="secondary" icon="sparkles" onClick={reconcile} disabled={busy}>
                Code {summary.notCoded.toLocaleString("en-AU")} uncoded
              </Button>
            ) : null}
            {acceptableCoded.length > 0 ? (
              <Button variant="soft" icon="check" onClick={() => accept(acceptableCoded)} disabled={busy}>
                Accept all ready ({acceptableCoded.length})
              </Button>
            ) : null}
            <Button icon="upload" onClick={() => setUpload(true)}>
              Upload statement
            </Button>
          </>
        }
      />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
            className={cx(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors",
              filter === chip.id
                ? "border-accent bg-accent-soft font-semibold text-accent-ink"
                : "border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink",
            )}
          >
            {chip.label}
            <span className={cx("figure rounded-full px-1.5 text-[11px] font-semibold", chip.tone === "warning" && chip.count > 0 ? "bg-warning-soft text-warning-ink" : "bg-sunken text-ink-2")}>
              {chip.count.toLocaleString("en-AU")}
            </span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {bankAccounts.length > 1 ? (
            <select
              value={bankAccountId}
              onChange={(event) => setBankAccountId(event.target.value)}
              aria-label="Bank account"
              className={cx(inputClass, "h-9 w-auto py-1")}
            >
              <option value="">All bank accounts</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search description or account"
              aria-label="Search transactions"
              className={cx(inputClass, "h-9 w-64 pl-9")}
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No transactions yet"
          body={`Upload a bank statement for ${clientName} and the engine will code it: rules and Coding Memory first, then the AI tier for whatever is left.`}
          action={
            <Button icon="upload" onClick={() => setUpload(true)}>
              Upload statement
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={filter === "review" ? "Nothing needs a look" : "Nothing here"}
          body={filter === "review" ? "Every coded transaction is either ready to accept or already accepted." : "Try another filter or search."}
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table className="review min-w-[58rem]">
            <thead>
              <tr>
                <th className="w-12">
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={visible.length > 0 && visible.every((row) => selected.has(row.id))}
                    onChange={(event) =>
                      setSelected(event.target.checked ? new Set(visible.map((row) => row.id)) : new Set())
                    }
                    className="size-4 accent-accent"
                  />
                </th>
                <th className="w-24">Date</th>
                <th>Description</th>
                <th className="w-32 text-right">Amount</th>
                <th className="w-[19rem]">Coding</th>
                <th className="w-28">Status</th>
                <th className="w-52 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const active = index === cursor;
                const level = confidenceLevel(row);
                const [day, month, year] = shortDate(row.date).split(" ");
                return (
                  <tr
                    key={row.id}
                    onClick={() => setCursor(index)}
                    aria-selected={active}
                    className={cx("relative", active && "!bg-accent-soft/50", row.excludedAt && "opacity-60")}
                  >
                    <td className="relative">
                      <ConfidenceRail level={level} />
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.description}`}
                        checked={selected.has(row.id)}
                        onChange={(event) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (event.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                        className="size-4 accent-accent"
                      />
                    </td>
                    <td className="figure">
                      <span className="block text-[13px] font-semibold text-ink">
                        {day} {month}
                      </span>
                      <span className="block text-xs text-ink-3">{year}</span>
                    </td>
                    <td>
                      <span className="block max-w-[26rem] truncate text-[14px] font-semibold text-ink" title={row.description}>
                        {row.description}
                      </span>
                      <span className="mt-1 flex max-w-[26rem] items-center gap-1.5 text-xs text-ink-3">
                        <Icon name="landmark" className="size-3 shrink-0" />
                        <span className="shrink-0">{row.bankAccountName}</span>
                        {row.reasoning ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate" title={row.reasoning}>
                              {row.reasoning}
                            </span>
                          </>
                        ) : null}
                        {row.excludeReason ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate text-negative-ink">Excluded: {row.excludeReason}</span>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="figure text-right">
                      <span className="text-[14px] font-semibold">
                        <Money cents={row.amountCents} />
                      </span>
                    </td>
                    <td>
                      {row.accountCode !== null ? (
                        <>
                          <span className="flex items-center gap-2">
                            <span className="code shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2">{row.accountCode}</span>
                            <span className="truncate text-[13px] font-medium text-ink">{row.accountName}</span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                            <span>{row.gstTreatment ? GST_TREATMENT_LABELS[row.gstTreatment] : "No tax code"}</span>
                            {row.gstCents !== 0 ? (
                              <span className="figure">
                                <span aria-hidden="true">· </span>GST <Money cents={row.gstCents} />
                              </span>
                            ) : null}
                            {row.source ? (
                              <Badge tone={row.source === "AI" ? "accent" : "neutral"} className="!text-[10px]">
                                {SOURCE_LABELS[row.source]}
                              </Badge>
                            ) : null}
                            {row.risk === "HIGH" ? (
                              <Badge tone="warning" className="!text-[10px]">
                                High risk
                              </Badge>
                            ) : null}
                          </span>
                        </>
                      ) : (
                        <span className="text-[13px] text-ink-3">Not coded yet</span>
                      )}
                    </td>
                    <td>
                      {row.excludedAt ? (
                        <Badge tone="neutral">Excluded</Badge>
                      ) : row.status === "REVIEWED" ? (
                        <Badge tone="positive" dot>
                          Accepted
                        </Badge>
                      ) : row.status === "PENDING" ? (
                        <Badge tone="outline">Not coded</Badge>
                      ) : row.needsReview ? (
                        <Badge tone="warning" dot>
                          Review
                        </Badge>
                      ) : (
                        <Badge tone="accent" dot>
                          Ready
                        </Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {row.excludedAt ? (
                          <Button variant="secondary" size="sm" icon="undo" disabled={busy} onClick={() => run(() => restoreTransaction(clientId, row.id))}>
                            Restore
                          </Button>
                        ) : row.status === "REVIEWED" ? (
                          <>
                            {row.journalEntryId ? (
                              <Link href={`/clients/${clientId}/journals/${row.journalEntryId}`} className={buttonClass({ variant: "soft", size: "sm" })}>
                                <Icon name="book-open" className="size-3.5" />
                                Journal
                              </Link>
                            ) : null}
                            <Button variant="secondary" size="sm" icon="undo" disabled={busy} onClick={() => run(() => reopenTransaction(clientId, row.id))}>
                              Reopen
                            </Button>
                          </>
                        ) : (
                          <>
                            {canAccept(row) ? (
                              <Button variant="soft" size="sm" icon="check" disabled={busy} onClick={() => accept([row.id])}>
                                Accept
                              </Button>
                            ) : null}
                            <Button variant="secondary" size="sm" icon="pen" disabled={busy} onClick={() => setRecode(row)}>
                              Recode
                            </Button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setExclude(row)}
                              aria-label="Exclude"
                              title="Exclude from the books"
                              className="inline-flex size-9 items-center justify-center rounded-xl border border-rule bg-surface text-ink-2 shadow-xs transition-colors hover:border-negative/40 hover:bg-negative-soft hover:text-negative-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Icon name="x-circle" className="size-4" />
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>A</Kbd> accept</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>E</Kbd> recode</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>X</Kbd> exclude</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>N</Kbd> next needing review</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>Space</Kbd> select</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>Shift</Kbd><Kbd>A</Kbd> accept selected</span>
        {selected.size > 0 ? (
          <Button size="sm" variant="soft" className="ml-auto" disabled={busy} onClick={() => accept([...selected])}>
            Accept {selected.size} selected
          </Button>
        ) : null}
      </div>

      {recode ? (
        <RecodeModal
          key={recode.id}
          clientId={clientId}
          transaction={recode}
          accounts={accounts}
          subcontractors={subcontractors}
          onClose={() => setRecode(null)}
        />
      ) : null}
      {exclude ? (
        <ExcludeModal
          transaction={exclude}
          onClose={() => setExclude(null)}
          onConfirm={(reason) => {
            setExclude(null);
            void run(() => excludeTransaction(clientId, exclude.id, { reason }));
          }}
        />
      ) : null}
      {upload ? (
        <UploadStatementModal
          targets={[{ clientId, clientName, bankAccounts }]}
          initialClientId={clientId}
          onClose={() => setUpload(false)}
        />
      ) : null}
    </div>
  );
}

function ExcludeModal({
  transaction,
  onClose,
  onConfirm,
}: {
  transaction: TransactionRow;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title="Exclude from the books"
      description="The row stays on file with the reason. It can be restored at any time."
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        <p className="text-sm">
          <span className="font-medium">{transaction.description}</span> · <Money cents={transaction.amountCents} />
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="exclude-reason" className="text-sm font-medium text-ink">
            Reason
          </label>
          <input
            id="exclude-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Personal spend, reimbursed by the owner"
            maxLength={200}
            className={inputClass}
          />
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={reason.trim() === ""} onClick={() => onConfirm(reason.trim())}>
          Exclude
        </Button>
      </ModalFooter>
    </Modal>
  );
}

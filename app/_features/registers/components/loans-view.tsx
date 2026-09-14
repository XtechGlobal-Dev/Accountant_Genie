"use client";

/**
 * The loan register. Each loan's schedule splits repayments into principal
 * and interest so a repayment is never expensed whole.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createLoan, setLoanStatus, updateLoan } from "@/server/modules/loans/actions";
import type { AccountOption } from "@/shared/contracts/account";
import type { LoanRow } from "@/shared/contracts/register";
import { shortDate } from "@/shared/format";
import { basisPointsToInput, centsToInput, formatBasisPoints } from "@/shared/money";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Select,
} from "@/ui/primitives";

const FREQUENCY: Record<LoanRow["frequency"], string> = { WEEKLY: "Weekly", FORTNIGHTLY: "Fortnightly", MONTHLY: "Monthly" };

type Editing = { mode: "new" } | { mode: "edit"; row: LoanRow } | null;

export function LoansView({ clientId, rows, accounts }: { clientId: string; rows: LoanRow[]; accounts: AccountOption[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const liabilityAccounts = accounts.filter((a) => a.type === "LIABILITY");

  async function toggle(row: LoanRow) {
    setBusy(row.id);
    await setLoanStatus(clientId, row.id, row.status === "ACTIVE" ? "CLOSED" : "ACTIVE");
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Loans"
        context="Facilities the client repays. The schedule splits each repayment into principal and interest."
        action={
          <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
            Add loan
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="banknote"
          title="No Loans Found"
          body="Add loans to see details. Repayments then code as principal (BAS excluded) and interest (input taxed) rather than as one expense."
          action={
            <Button size="lg" icon="plus" className="rounded-full" onClick={() => setEditing({ mode: "new" })}>
              Add Your First Loan
            </Button>
          }
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Lender</th>
                <th className="w-32 text-right">Principal</th>
                <th className="w-24 text-right">Rate</th>
                <th className="w-28">Started</th>
                <th className="w-24 text-right">Term</th>
                <th className="w-36 text-right">Repayment</th>
                <th className="w-28">Status</th>
                <th className="w-44 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.status === "CLOSED" ? "opacity-60" : undefined}>
                  <td>
                    <Link href={`/clients/${clientId}/loans/${row.id}`} className="font-medium hover:text-accent">
                      {row.lender}
                    </Link>
                    {row.description ? <span className="block text-xs text-ink-3">{row.description}</span> : null}
                  </td>
                  <td className="text-right">
                    <Money cents={row.principalCents} />
                  </td>
                  <td className="figure text-right text-ink-2">{formatBasisPoints(row.interestRateBasisPoints)}</td>
                  <td className="figure text-ink-2">{shortDate(row.startDate)}</td>
                  <td className="figure text-right text-ink-2">{row.termMonths} mo</td>
                  <td className="text-right">
                    <Money cents={row.repaymentCents} /> <span className="text-xs text-ink-3">{FREQUENCY[row.frequency].toLowerCase()}</span>
                  </td>
                  <td>
                    <Badge tone={row.status === "ACTIVE" ? "positive" : "neutral"}>{row.status === "ACTIVE" ? "Active" : "Closed"}</Badge>
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Link href={`/clients/${clientId}/loans/${row.id}`} className="text-xs font-medium text-accent hover:underline">
                        Schedule
                      </Link>
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", row })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => toggle(row)}>
                        {row.status === "ACTIVE" ? "Close" : "Reopen"}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <LoanModal
          key={editing.mode === "edit" ? editing.row.id : "new"}
          clientId={clientId}
          row={editing.mode === "edit" ? editing.row : null}
          accounts={liabilityAccounts}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function LoanModal({ clientId, row, accounts, onClose }: { clientId: string; row: LoanRow | null; accounts: AccountOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = row ? await updateLoan(clientId, row.id, formData) : await createLoan(clientId, formData);
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
    <Modal open onClose={onClose} title={row ? "Edit loan" : "New loan"} description="The terms as they appear on the loan contract." size="lg">
      <form action={submit}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lender" name="lender" required defaultValue={row?.lender ?? ""} placeholder="e.g. Westpac equipment finance" error={errorFor("lender")} />
            <Field label="Description" name="description" defaultValue={row?.description ?? ""} placeholder="What the loan is for" error={errorFor("description")} />
            <Field label="Amount borrowed" name="principal" required inputMode="decimal" defaultValue={row ? centsToInput(row.principalCents) : ""} placeholder="0.00" error={errorFor("principalCents")} />
            <Field label="Interest rate (% p.a.)" name="interestRate" required inputMode="decimal" defaultValue={row ? basisPointsToInput(row.interestRateBasisPoints) : ""} placeholder="e.g. 7.25" error={errorFor("interestRateBasisPoints")} />
            <Field label="Start date" name="startDate" required type="date" defaultValue={row ? row.startDate.toISOString().slice(0, 10) : ""} error={errorFor("startDate")} />
            <Field label="Term (months)" name="termMonths" required type="number" inputMode="numeric" defaultValue={row ? String(row.termMonths) : ""} placeholder="e.g. 60" error={errorFor("termMonths")} />
            <Field label="Repayment" name="repayment" required inputMode="decimal" defaultValue={row ? centsToInput(row.repaymentCents) : ""} placeholder="0.00" error={errorFor("repaymentCents")} />
            <Select label="Repayment frequency" name="frequency" defaultValue={row?.frequency ?? "MONTHLY"}>
              <option value="MONTHLY">Monthly</option>
              <option value="FORTNIGHTLY">Fortnightly</option>
              <option value="WEEKLY">Weekly</option>
            </Select>
            <Select label="Liability account" name="accountId" defaultValue={row?.accountId ?? ""} error={errorFor("accountId")} className="sm:col-span-2">
              <option value="">Not linked</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : row ? "Save changes" : "Add loan"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

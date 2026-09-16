"use client";

/**
 * Prepared BAS statements: keep the figures as they stand, adjust a label
 * with a reason, and sign the statement off. The live BAS above recomputes on
 * every view; a prepared statement is what the firm actually reviewed and
 * handed on, kept as three figures per label so an adjustment never hides
 * what the ledger said.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adjustBasLine, finaliseBas, prepareBas } from "@/server/modules/reports/actions";
import type { BasStatementRow, BasStatementView } from "@/shared/contracts/report";
import { money, shortDate } from "@/shared/format";
import { Alert, Badge, Button, Card, CardHeader, Field, Modal, ModalFooter, Money, submitWith } from "@/ui/primitives";

export function PrepareBasButton({
  clientId,
  query,
  canPrepare,
  ready,
}: {
  clientId: string;
  query: { fy?: string; q?: string; m?: string };
  canPrepare: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!canPrepare) return null;

  function prepare() {
    setError(null);
    startTransition(async () => {
      const result = await prepareBas(clientId, query);
      if (result.ok) router.push(`/clients/${clientId}/reports/bas/${result.id}`);
      else setError(result.error);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button icon="shield-check" onClick={prepare} disabled={pending || !ready} title={ready ? undefined : "Every line must be resolved first"}>
        {pending ? "Preparing…" : "Prepare statement"}
      </Button>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </span>
  );
}

export function BasStatementsList({ clientId, statements }: { clientId: string; statements: BasStatementRow[] }) {
  if (statements.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Prepared statements" description="Kept as they were prepared. A finalised statement is never edited; a correction is a new statement." />
      <table>
        <thead>
          <tr>
            <th>Period</th>
            <th className="w-32">Status</th>
            <th className="w-40 text-right">Net GST</th>
            <th className="w-40">Prepared by</th>
            <th className="w-32">Prepared</th>
          </tr>
        </thead>
        <tbody>
          {statements.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/clients/${clientId}/reports/bas/${row.id}`} className="font-medium hover:text-accent">
                  {row.periodLabel}
                </Link>
              </td>
              <td>{row.status === "FINAL" ? <Badge tone="positive">Final</Badge> : <Badge tone="warning">Draft</Badge>}</td>
              <td className="text-right">
                <Money cents={row.netGstCents} />
              </td>
              <td className="text-ink-2">{row.preparedBy ?? "—"}</td>
              <td className="figure text-ink-2">{shortDate(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function BasStatementDetail({
  clientId,
  statement,
  canAdjust,
  canFinalise,
}: {
  clientId: string;
  statement: BasStatementView;
  canAdjust: boolean;
  canFinalise: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = statement.status === "DRAFT";

  function finalise() {
    setError(null);
    startTransition(async () => {
      const result = await finaliseBas(clientId, statement.id, statement.version);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const line = adjusting ? statement.lines.find((l) => l.label === adjusting) : null;

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="negative">{error}</Alert> : null}
      {!statement.mappingVerified ? (
        <Alert tone="warning" title="Prepared with unverified mappings">
          One or more of the rules this statement depends on (W1/W2 accounts, input-taxed labels) had not been
          verified by the registered tax advisor when it was prepared. The rule versions consulted are recorded
          below.
        </Alert>
      ) : null}

      <div className="card overflow-x-auto">
        <table className="min-w-[44rem]">
          <thead>
            <tr>
              <th className="w-20">Label</th>
              <th>Title</th>
              <th className="w-36 text-right">Calculated</th>
              <th className="w-36 text-right">Adjustment</th>
              <th className="w-36 text-right">Final</th>
              <th>Reason</th>
              <th className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((l) => (
              <tr key={l.label}>
                <td className="code font-semibold">{l.label}</td>
                <td>{l.title}</td>
                <td className="text-right">
                  <Money cents={l.calculatedCents} />
                </td>
                <td className="text-right">{l.adjustmentCents !== 0 ? <Money cents={l.adjustmentCents} /> : <span className="text-ink-3">—</span>}</td>
                <td className="text-right">
                  <Money cents={l.finalCents} emphasis />
                </td>
                <td className="text-ink-2">{l.note ?? ""}</td>
                <td className="text-right">
                  {draft && canAdjust ? (
                    <Button variant="ghost" size="sm" onClick={() => setAdjusting(l.label)}>
                      Adjust
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Net GST (1A − 1B) on the final figures</td>
              <td className="text-right">
                <Money cents={statement.netGstCents} emphasis />
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-ink-3">
          Prepared {shortDate(statement.createdAt)}
          {statement.preparedBy ? ` by ${statement.preparedBy}` : ""} from {statement.lineCount.toLocaleString("en-AU")} journal
          lines.
          {statement.status === "FINAL" && statement.finalisedAt
            ? ` Finalised ${shortDate(statement.finalisedAt)}${statement.finalisedBy ? ` by ${statement.finalisedBy}` : ""}.`
            : ""}{" "}
          Rule versions:{" "}
          {Object.entries(statement.taxRuleVersions)
            .map(([code, id]) => `${code} ${id ? "verified" : "unverified"}`)
            .join(" · ")}
          .
        </p>
        {draft && canFinalise ? (
          <Button icon="shield-check" onClick={finalise} disabled={pending}>
            {pending ? "Finalising…" : "Finalise statement"}
          </Button>
        ) : null}
      </div>

      {line ? (
        <AdjustModal
          clientId={clientId}
          statementId={statement.id}
          version={statement.version}
          label={line.label}
          title={line.title}
          calculatedCents={line.calculatedCents}
          adjustmentCents={line.adjustmentCents}
          note={line.note}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
    </div>
  );
}

function AdjustModal({
  clientId,
  statementId,
  version,
  label,
  title,
  calculatedCents,
  adjustmentCents,
  note,
  onClose,
}: {
  clientId: string;
  statementId: string;
  version: number;
  label: string;
  title: string;
  calculatedCents: number;
  adjustmentCents: number;
  note: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("label", label);
    formData.set("version", String(version));
    startTransition(async () => {
      const result = await adjustBasLine(clientId, statementId, formData);
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
      title={`Adjust ${label} · ${title}`}
      description={`Calculated from the ledger: ${money(calculatedCents)}. The calculated figure stays; the adjustment and its reason are recorded alongside it.`}
    >
      <form onSubmit={submitWith(submit)}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}
          <Field
            label="Adjustment (dollars, negative to reduce)"
            name="adjustment"
            inputMode="decimal"
            defaultValue={adjustmentCents === 0 ? "" : (adjustmentCents / 100).toFixed(2)}
            placeholder="0.00"
            error={errorFor("adjustment")}
          />
          <Field label="Reason" name="note" required defaultValue={note ?? ""} placeholder="e.g. Late supplier invoice dated in the period" error={errorFor("note")} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save adjustment"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

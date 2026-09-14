"use client";

/**
 * Upload a bank statement — CSV or PDF.
 *
 * Pick the client, then the account, then the file. The upload returns a
 * job; the dialog follows its stages live and then shows the outcome — rows
 * read, duplicates skipped, how many the engine coded and how many it routed
 * to review — with a link straight to the review screen.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getImportOutcome, getUploadTargets, uploadStatement } from "@/server/modules/ingest/actions";
import type { ImportOutcome, UploadTarget } from "@/shared/contracts/transaction";
import { JobProgress } from "@/features/shell/components/job-progress";
import { Alert, Button, Modal, ModalFooter, Select, cx, inputClass } from "@/ui/primitives";

type Phase =
  | { step: "form" }
  | { step: "running"; importId: string; jobId: string }
  | { step: "done"; outcome: ImportOutcome };

export function UploadStatementModal({
  targets: initialTargets,
  initialClientId,
  initialBankAccountId,
  onClose,
}: {
  /** Omit to have the dialog fetch them. */
  targets?: UploadTarget[] | undefined;
  initialClientId?: string | undefined;
  initialBankAccountId?: string | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<UploadTarget[] | null>(initialTargets ?? null);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [bankAccountId, setBankAccountId] = useState(initialBankAccountId ?? "");
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (targets) return;
    getUploadTargets().then(setTargets).catch(() => setError("Could not load clients"));
  }, [targets]);

  const client = targets?.find((t) => t.clientId === clientId);
  useEffect(() => {
    if (!client) return;
    if (!client.bankAccounts.some((b) => b.id === bankAccountId)) {
      setBankAccountId(client.bankAccounts[0]?.id ?? "");
    }
  }, [client, bankAccountId]);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("bankAccountId", bankAccountId);
    startTransition(async () => {
      const result = await uploadStatement(formData);
      if (result.ok) {
        setPhase({ step: "running", importId: result.importId, jobId: result.jobId });
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }

  async function finish(importId: string) {
    const outcome = await getImportOutcome(importId);
    if (outcome) setPhase({ step: "done", outcome });
    router.refresh();
  }

  const outcome = phase.step === "done" ? phase.outcome : null;
  const stats = outcome?.reconcile ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload bank statement"
      description="A CSV or PDF export from the client's bank. Rows already on file are skipped; the rest are coded straight away."
      size="lg"
    >
      {phase.step === "running" ? (
        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-sm text-ink-2">
            The statement is being processed. You can close this and follow it in the Activity Panel.
          </p>
          <JobProgress jobId={phase.jobId} onDone={() => finish(phase.importId)} />
        </div>
      ) : outcome ? (
        <div className="flex flex-col gap-4 px-5 py-5">
          {outcome.status === "FAILED" ? (
            <Alert tone="negative" title="The import did not complete">
              {outcome.error ?? "The file could not be read."} The original is kept; nothing was posted.
            </Alert>
          ) : (
            <Alert tone="positive" title="Statement imported">
              {outcome.insertedCount.toLocaleString("en-AU")} new transaction
              {outcome.insertedCount === 1 ? "" : "s"} from {outcome.rowCount.toLocaleString("en-AU")} rows
              {outcome.duplicateCount > 0 ? ` · ${outcome.duplicateCount.toLocaleString("en-AU")} already on file` : ""}
              {outcome.failedCount > 0 ? ` · ${outcome.failedCount.toLocaleString("en-AU")} rows could not be read` : ""}
            </Alert>
          )}
          {stats ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-rule bg-surface-2 px-4 py-3 text-sm sm:grid-cols-3">
              <Stat label="Coded by memory" value={stats.byMemory} />
              <Stat label="Coded by rules" value={stats.byRule} />
              <Stat label="Coded by AI" value={stats.byAi} />
              <Stat label="Ready to accept" value={stats.autoCoded} tone="positive" />
              <Stat label="Need a look" value={stats.needsReview} tone="warning" />
              <Stat label="Unknown" value={stats.unknown} />
            </dl>
          ) : null}
          {stats?.aiFailure ? (
            <Alert tone="warning" title="The AI tier did not answer">
              {stats.aiFailure}. Those transactions are waiting in review as Unknown; nothing was guessed.
            </Alert>
          ) : null}
        </div>
      ) : (
        <form action={submit}>
          <div className="flex flex-col gap-5 px-5 py-5">
            {error && !field ? <Alert tone="negative">{error}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Client"
                name="clientId"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={!targets || initialClientId !== undefined}
              >
                <option value="">{targets ? "Choose a client…" : "Loading…"}</option>
                {targets?.map((t) => (
                  <option key={t.clientId} value={t.clientId}>
                    {t.clientName}
                  </option>
                ))}
              </Select>
              <Select
                label="Bank account"
                name="bankAccountSelect"
                value={bankAccountId}
                onChange={(event) => setBankAccountId(event.target.value)}
                disabled={!client}
                error={field === "bankAccountId" ? (error ?? undefined) : undefined}
                hint={client && client.bankAccounts.length === 0 ? "This client has no bank account yet." : undefined}
              >
                <option value="">Choose an account…</option>
                {client?.bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="statement-file" className="text-sm font-medium text-ink">
                Statement file
              </label>
              <label
                className={cx(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-5 py-8 text-center transition-colors",
                  field === "file" ? "border-negative bg-negative-soft" : "border-rule-strong bg-surface-2 hover:border-accent",
                )}
              >
                <input
                  id="statement-file"
                  ref={fileRef}
                  type="file"
                  name="file"
                  accept=".csv,.pdf,text/csv,application/pdf"
                  required
                  className="sr-only"
                  onChange={(event) => setFilename(event.target.files?.[0]?.name ?? null)}
                />
                <span className="text-sm font-medium">{filename ?? "Choose a CSV or PDF"}</span>
                <span className="text-xs text-ink-3">Up to 10 MB. Scanned PDFs have no text to read and are refused.</span>
              </label>
              {field === "file" && error ? <p className="text-xs font-medium text-negative-ink">{error}</p> : null}
            </div>

            <p className="text-xs leading-relaxed text-ink-3">
              The original file is kept for audit. Nothing reaches the ledger until a person accepts
              each transaction.
            </p>
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" icon="upload" disabled={pending || !bankAccountId || !filename}>
              {pending ? "Uploading…" : "Import"}
            </Button>
          </ModalFooter>
        </form>
      )}
      {phase.step !== "form" ? (
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {outcome && outcome.status !== "FAILED" ? (
            <Link
              href={`/clients/${clientId}/transactions`}
              onClick={onClose}
              className={cx(inputClass, "inline-flex w-auto items-center justify-center border-transparent bg-accent px-4 font-semibold text-white shadow-none hover:bg-accent-ink")}
            >
              Review transactions
            </Link>
          ) : null}
        </ModalFooter>
      ) : null}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "positive" | "warning" }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cx("figure text-lg font-semibold", tone === "positive" && "text-positive-ink", tone === "warning" && "text-warning-ink")}>
        {value.toLocaleString("en-AU")}
      </dd>
    </div>
  );
}

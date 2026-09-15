"use client";

/**
 * The trustee and beneficiaries of a trust client, on the entity tab.
 *
 * Read-only summary with an edit modal; the same fields as the second step
 * of New Client, so what was skipped there can be completed here.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTrustDetails } from "@/server/modules/clients/actions";
import type { TrustDetails } from "@/shared/contracts/client";
import { abn as formatAbn } from "@/shared/format";
import { BENEFICIARY_KIND_LABELS, TRUSTEE_KIND_LABELS } from "@/shared/labels";
import { Alert, Avatar, Badge, Button, Card, CardHeader, Modal, ModalFooter } from "@/ui/primitives";
import { TrustDetailsFields, emptyTrustDraft, trustDraftComplete, trustDraftFrom, trustPayload, type TrustDraft } from "./trust-details-fields";

export function TrustDetailsCard({ clientId, details }: { clientId: string; details: TrustDetails }) {
  const [open, setOpen] = useState(false);
  const { trustee, beneficiaries } = details;
  const empty = !trustee && beneficiaries.length === 0;

  return (
    <Card>
      <CardHeader
        title="Trustee & beneficiaries"
        description="Who holds the trust's assets, and who it can distribute to."
        action={
          <Button variant="secondary" size="sm" icon="pen" onClick={() => setOpen(true)}>
            {empty ? "Add trust details" : "Edit"}
          </Button>
        }
      />
      {empty ? (
        <p className="px-5 py-6 text-sm text-ink-2">
          No trustee or beneficiaries recorded yet. Distributions cannot be prepared until there is at least one beneficiary.
        </p>
      ) : (
        <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-rule-soft">
          <dl className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2.5">
              <dt className="text-sm text-ink-2">Trustee</dt>
              <dd className="text-right text-sm font-medium text-ink">
                {trustee ? (
                  <>
                    {trustee.name}
                    <Badge tone="outline" className="ml-2">{TRUSTEE_KIND_LABELS[trustee.kind]}</Badge>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            {trustee?.kind === "CORPORATE" ? (
              <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2.5">
                <dt className="text-sm text-ink-2">Trustee ABN</dt>
                <dd className="figure text-sm font-medium text-ink">{formatAbn(trustee.abn)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-sm text-ink-2">{trustee?.kind === "INDIVIDUAL" ? "Co-trustees" : "Directors who sign"}</dt>
              <dd className="text-right text-sm font-medium text-ink">
                {trustee && trustee.signatories.length > 0 ? trustee.signatories.join(", ") : "—"}
              </dd>
            </div>
          </dl>
          <table>
            <thead>
              <tr>
                <th>Beneficiary</th>
                <th className="w-32 text-right">Type</th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((beneficiary) => (
                <tr key={beneficiary.id}>
                  <td>
                    <span className="flex items-center gap-2.5 font-medium">
                      <Avatar name={beneficiary.name} size="sm" />
                      {beneficiary.name}
                    </span>
                  </td>
                  <td className="text-right text-ink-2">{BENEFICIARY_KIND_LABELS[beneficiary.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? <TrustDetailsModal clientId={clientId} details={details} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function TrustDetailsModal({ clientId, details, onClose }: { clientId: string; details: TrustDetails; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrustDraft>(() =>
    details.trustee || details.beneficiaries.length > 0 ? trustDraftFrom(details) : emptyTrustDraft(),
  );
  const canSave = trustDraftComplete(draft);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveTrustDetails(clientId, trustPayload(draft));
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Trustee & beneficiaries" size="lg">
      <div className="flex flex-col gap-4 px-5 py-5">
        {error ? <Alert tone="negative">{error}</Alert> : null}
        <TrustDetailsFields draft={draft} onChange={setDraft} />
      </div>
      <ModalFooter note={canSave ? undefined : "The trustee needs a name, and every beneficiary needs one too."}>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSave || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

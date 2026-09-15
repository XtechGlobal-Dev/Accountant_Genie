"use client";

/**
 * The partners of a partnership and their shares, on the entity tab.
 *
 * Read-only table with an edit modal; the same fields as the second step
 * of New Client, so what was skipped there can be completed here.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePartners } from "@/server/modules/clients/actions";
import type { Partner } from "@/shared/contracts/client";
import { formatBasisPoints } from "@/shared/money";
import { Alert, Avatar, Button, Card, CardHeader, Modal, ModalFooter, cx } from "@/ui/primitives";
import { PARTNERS_NOTE, PartnersFields, partnersDraftFrom, partnersPayload, partnersSummary, type PartnerDraft } from "./partners-fields";

export function PartnersCard({ clientId, partners }: { clientId: string; partners: Partner[] }) {
  const [open, setOpen] = useState(false);
  const total = partners.reduce((sum, partner) => sum + partner.shareBasisPoints, 0);

  return (
    <Card>
      <CardHeader
        icon="users"
        title="Partners"
        description="Each partner's share of the partnership's profit."
        action={
          <Button variant="secondary" size="sm" icon="pen" onClick={() => setOpen(true)}>
            {partners.length === 0 ? "Add partners" : "Edit partners"}
          </Button>
        }
      />
      {partners.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-2">
          No partners recorded yet. Distributions cannot be prepared until the shares add up to
          100%.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Partner</th>
              <th className="w-32 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((partner) => (
              <tr key={partner.id}>
                <td>
                  <span className="flex items-center gap-2.5 font-medium">
                    <Avatar name={partner.name} size="sm" />
                    {partner.name}
                  </span>
                </td>
                <td className="figure text-right">{formatBasisPoints(partner.shareBasisPoints)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className={cx("figure text-right", total === 10_000 ? "text-positive-ink" : "text-negative-ink")}>
                {formatBasisPoints(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {open ? <PartnersModal clientId={clientId} partners={partners} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function PartnersModal({ clientId, partners, onClose }: { clientId: string; partners: Partner[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PartnerDraft[]>(() => partnersDraftFrom(partners));
  const { canSave } = partnersSummary(drafts);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await savePartners(clientId, partnersPayload(drafts));
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
      icon="users"
      title="Partners"
      description="Names and profit shares. The shares must add up to exactly 100%."
      size="lg"
    >
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        {error ? <Alert tone="negative">{error}</Alert> : null}
        <PartnersFields drafts={drafts} onChange={setDrafts} />
      </div>
      <ModalFooter note={canSave ? undefined : PARTNERS_NOTE}>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button icon="save" onClick={submit} disabled={!canSave || pending}>
          {pending ? "Saving…" : "Save partners"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

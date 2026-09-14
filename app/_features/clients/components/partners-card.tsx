"use client";

/**
 * The partners of a partnership and their shares.
 *
 * Shares are edited as percentages and stored as basis points; the running
 * total is shown while typing, and the set cannot be saved until it is
 * exactly 100.00%. The server applies the same rule.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePartners } from "@/server/modules/clients/actions";
import type { Partner } from "@/shared/contracts/client";
import { basisPointsToInput, formatBasisPoints, parseBasisPoints } from "@/shared/money";
import { Icon } from "@/ui/icons";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Modal,
  ModalFooter,
  cx,
  inputClass,
} from "@/ui/primitives";

interface Draft {
  key: number;
  name: string;
  share: string;
}

let nextKey = 1;
const draftFrom = (partner?: Partner): Draft => ({
  key: nextKey++,
  name: partner?.name ?? "",
  share: partner ? basisPointsToInput(partner.shareBasisPoints) : "",
});

export function PartnersCard({ clientId, partners }: { clientId: string; partners: Partner[] }) {
  const [open, setOpen] = useState(false);
  const total = partners.reduce((sum, partner) => sum + partner.shareBasisPoints, 0);

  return (
    <Card>
      <CardHeader
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

      {open ? (
        <PartnersModal clientId={clientId} partners={partners} onClose={() => setOpen(false)} />
      ) : null}
    </Card>
  );
}

function PartnersModal({
  clientId,
  partners,
  onClose,
}: {
  clientId: string;
  partners: Partner[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    partners.length > 0 ? partners.map(draftFrom) : [draftFrom(), draftFrom()],
  );

  const parsed = drafts.map((draft) => ({
    name: draft.name.trim(),
    shareBasisPoints: draft.share.trim() === "" ? null : parseBasisPoints(draft.share),
  }));
  const total = parsed.reduce((sum, p) => sum + (p.shareBasisPoints ?? 0), 0);
  const complete = parsed.every((p) => p.name !== "" && p.shareBasisPoints !== null && p.shareBasisPoints > 0);
  const canSave = complete && total === 10_000 && drafts.length > 0;

  function update(key: number, patch: Partial<Draft>) {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await savePartners(clientId, {
        partners: parsed.map((p) => ({ name: p.name, shareBasisPoints: p.shareBasisPoints ?? 0 })),
      });
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
      title="Partners"
      description="Names and profit shares. The shares must add up to exactly 100%."
      size="lg"
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        {error ? <Alert tone="negative">{error}</Alert> : null}

        <div className="flex flex-col gap-2">
          {drafts.map((draft, index) => (
            <div key={draft.key} className="grid grid-cols-[1fr_8rem_2.5rem] items-center gap-2">
              <input
                value={draft.name}
                maxLength={120}
                onChange={(event) => update(draft.key, { name: event.target.value })}
                placeholder={`Partner ${index + 1} full name`}
                aria-label={`Partner ${index + 1} name`}
                className={inputClass}
              />
              <div className="relative">
                <input
                  value={draft.share}
                  inputMode="decimal"
                  onChange={(event) => update(draft.key, { share: event.target.value })}
                  placeholder="0.00"
                  aria-label={`Partner ${index + 1} share`}
                  aria-invalid={draft.share.trim() !== "" && parseBasisPoints(draft.share) === null ? true : undefined}
                  className={cx(inputClass, "figure pr-8 text-right")}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
                  %
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrafts((current) => current.filter((d) => d.key !== draft.key))}
                disabled={drafts.length <= 1}
                aria-label={`Remove partner ${index + 1}`}
                className="inline-flex size-10 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-negative disabled:opacity-30"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={() => setDrafts((current) => [...current, draftFrom()])}
          >
            Add partner
          </Button>
          <p
            className={cx(
              "figure text-sm font-semibold",
              total === 10_000 ? "text-positive-ink" : "text-warning-ink",
            )}
          >
            Total {formatBasisPoints(total)}
            {total !== 10_000 ? (
              <span className="ml-2 font-normal">
                ({total > 10_000 ? "over" : "under"} by {formatBasisPoints(Math.abs(10_000 - total))})
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <ModalFooter note={canSave ? undefined : "Every partner needs a name and a share, and the shares must total 100%."}>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSave || pending}>
          {pending ? "Saving…" : "Save partners"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

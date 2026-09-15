"use client";

/**
 * The editor for a partnership's partners and their shares.
 *
 * Shared by the second step of New Client and by the partners card on the
 * entity tab. Shares are typed as percentages and sent as basis points; the
 * running total is shown while typing, and nothing can be saved until it is
 * exactly 100.00%. The server applies the same rule.
 */

import type { Partner } from "@/shared/contracts/client";
import { basisPointsToInput, formatBasisPoints, parseBasisPoints } from "@/shared/money";
import { Icon } from "@/ui/icons";
import { Button, cx, inputClass } from "@/ui/primitives";

export interface PartnerDraft {
  key: number;
  name: string;
  share: string;
}

let nextKey = 1;
export const partnerDraft = (partner?: Partner): PartnerDraft => ({
  key: nextKey++,
  name: partner?.name ?? "",
  share: partner ? basisPointsToInput(partner.shareBasisPoints) : "",
});

export function emptyPartnersDraft(): PartnerDraft[] {
  return [partnerDraft(), partnerDraft()];
}

export function partnersDraftFrom(partners: Partner[]): PartnerDraft[] {
  return partners.length > 0 ? partners.map(partnerDraft) : emptyPartnersDraft();
}

/** The parsed set, its total, and whether it could be saved. */
export function partnersSummary(drafts: PartnerDraft[]) {
  const parsed = drafts.map((draft) => ({
    name: draft.name.trim(),
    shareBasisPoints: draft.share.trim() === "" ? null : parseBasisPoints(draft.share),
  }));
  const total = parsed.reduce((sum, p) => sum + (p.shareBasisPoints ?? 0), 0);
  const complete = parsed.every((p) => p.name !== "" && p.shareBasisPoints !== null && p.shareBasisPoints > 0);
  return { parsed, total, complete, canSave: complete && total === 10_000 && drafts.length > 0 };
}

/** What the server action receives. */
export function partnersPayload(drafts: PartnerDraft[]) {
  return {
    partners: partnersSummary(drafts).parsed.map((p) => ({ name: p.name, shareBasisPoints: p.shareBasisPoints ?? 0 })),
  };
}

export const PARTNERS_NOTE = "Every partner needs a name and a share, and the shares must total 100%.";

export function PartnersFields({ drafts, onChange }: { drafts: PartnerDraft[]; onChange: (next: PartnerDraft[]) => void }) {
  const { total } = partnersSummary(drafts);
  const update = (key: number, patch: Partial<PartnerDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <div className="flex flex-col gap-4">
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
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">%</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
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
        <Button variant="secondary" size="sm" icon="plus" disabled={drafts.length >= 50} onClick={() => onChange([...drafts, partnerDraft()])}>
          Add partner
        </Button>
        <p className={cx("figure text-sm font-semibold", total === 10_000 ? "text-positive-ink" : "text-warning-ink")}>
          Total {formatBasisPoints(total)}
          {total !== 10_000 ? (
            <span className="ml-2 font-normal">
              ({total > 10_000 ? "over" : "under"} by {formatBasisPoints(Math.abs(10_000 - total))})
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

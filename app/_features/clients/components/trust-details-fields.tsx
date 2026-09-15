"use client";

/**
 * The editor for a trust's trustee and beneficiaries.
 *
 * Shared by the second step of New Client and by the card on the client's
 * entity tab, so the two never drift. It owns no state: the parent holds a
 * `TrustDraft`, this renders it and reports edits, and `trustPayload` turns
 * the draft into what the server action expects.
 */

import type { Beneficiary, TrustDetails, Trustee } from "@/shared/contracts/client";
import type { BeneficiaryKind, TrusteeKind } from "@/shared/enums";
import { BENEFICIARY_KIND_LABELS, TRUSTEE_KIND_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
import { Button, cx, inputClass } from "@/ui/primitives";

export interface TrustDraft {
  trustee: { kind: TrusteeKind; name: string; abn: string; signatories: { key: number; name: string }[] };
  beneficiaries: { key: number; name: string; kind: BeneficiaryKind }[];
}

let nextKey = 1;
const key = () => nextKey++;

export function emptyTrustDraft(): TrustDraft {
  return {
    trustee: { kind: "CORPORATE", name: "", abn: "", signatories: [{ key: key(), name: "" }] },
    beneficiaries: [{ key: key(), name: "", kind: "INDIVIDUAL" }],
  };
}

export function trustDraftFrom(details: TrustDetails): TrustDraft {
  const trustee: Trustee | null = details.trustee;
  return {
    trustee: {
      kind: trustee?.kind ?? "CORPORATE",
      name: trustee?.name ?? "",
      abn: trustee?.abn ?? "",
      signatories: (trustee?.signatories.length ? trustee.signatories : [""]).map((name) => ({ key: key(), name })),
    },
    beneficiaries: (details.beneficiaries.length
      ? details.beneficiaries
      : [{ id: "", name: "", kind: "INDIVIDUAL" as BeneficiaryKind }]
    ).map((b: Beneficiary) => ({ key: key(), name: b.name, kind: b.kind })),
  };
}

/** What the server action receives. Blank signatory rows are dropped; blank beneficiaries are not. */
export function trustPayload(draft: TrustDraft) {
  return {
    trustee: {
      kind: draft.trustee.kind,
      name: draft.trustee.name.trim(),
      abn: draft.trustee.kind === "CORPORATE" ? draft.trustee.abn.trim() : "",
      signatories: draft.trustee.signatories.map((s) => s.name.trim()).filter(Boolean),
    },
    beneficiaries: draft.beneficiaries.map((b) => ({ name: b.name.trim(), kind: b.kind })),
  };
}

/** Everything the server will insist on, checked here so the button can say so first. */
export function trustDraftComplete(draft: TrustDraft): boolean {
  return (
    draft.trustee.name.trim() !== "" &&
    draft.beneficiaries.length > 0 &&
    draft.beneficiaries.every((b) => b.name.trim() !== "")
  );
}

const TRUSTEE_KINDS: readonly TrusteeKind[] = ["CORPORATE", "INDIVIDUAL"];
const BENEFICIARY_KINDS: readonly BeneficiaryKind[] = ["INDIVIDUAL", "COMPANY", "TRUST"];

export function TrustDetailsFields({
  draft,
  onChange,
}: {
  draft: TrustDraft;
  onChange: (next: TrustDraft) => void;
}) {
  const corporate = draft.trustee.kind === "CORPORATE";
  const setTrustee = (patch: Partial<TrustDraft["trustee"]>) => onChange({ ...draft, trustee: { ...draft.trustee, ...patch } });

  return (
    <div className="flex flex-col gap-5">
      {/* Trustee */}
      <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
        <div>
          <p className="text-base font-bold">Trustee</p>
          <p className="mt-0.5 text-[13px] text-ink-2">Who holds the trust's assets and signs for it.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink">Trustee type</span>
          <div role="radiogroup" aria-label="Trustee type" className="grid grid-cols-2 gap-3 sm:max-w-sm">
            {TRUSTEE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.trustee.kind === kind}
                onClick={() => setTrustee({ kind })}
                className={cx(
                  "h-11 rounded-control border text-sm font-medium transition-colors",
                  draft.trustee.kind === kind
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink",
                )}
              >
                {TRUSTEE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink">{corporate ? "Trustee company name" : "Trustee's full name"}</span>
            <input
              value={draft.trustee.name}
              maxLength={200}
              onChange={(event) => setTrustee({ name: event.target.value })}
              placeholder={corporate ? "e.g. Horizon Holdings Pty Ltd" : "e.g. Priya Sharma"}
              className={inputClass}
            />
          </label>
          {corporate ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-ink">
                Trustee ABN <span className="ml-1.5 font-normal text-ink-3">optional</span>
              </span>
              <input
                value={draft.trustee.abn}
                inputMode="numeric"
                onChange={(event) => setTrustee({ abn: event.target.value })}
                placeholder="XX XXX XXX XXX"
                className={cx(inputClass, "figure")}
              />
            </label>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink">
              {corporate ? "Directors who sign" : "Co-trustees"}
              <span className="ml-1.5 font-normal text-ink-3">optional</span>
            </span>
          </div>
          {draft.trustee.signatories.map((signatory, index) => (
            <div key={signatory.key} className="grid grid-cols-[1fr_2.5rem] items-center gap-2">
              <input
                value={signatory.name}
                maxLength={120}
                onChange={(event) =>
                  setTrustee({
                    signatories: draft.trustee.signatories.map((s) => (s.key === signatory.key ? { ...s, name: event.target.value } : s)),
                  })
                }
                placeholder={`${corporate ? "Director" : "Co-trustee"} ${index + 1} full name`}
                aria-label={`${corporate ? "Director" : "Co-trustee"} ${index + 1}`}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setTrustee({ signatories: draft.trustee.signatories.filter((s) => s.key !== signatory.key) })}
                disabled={draft.trustee.signatories.length <= 1}
                aria-label={`Remove ${corporate ? "director" : "co-trustee"} ${index + 1}`}
                className="inline-flex size-10 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-negative disabled:opacity-30"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={draft.trustee.signatories.length >= 20}
              onClick={() => setTrustee({ signatories: [...draft.trustee.signatories, { key: key(), name: "" }] })}
            >
              {corporate ? "Add director" : "Add co-trustee"}
            </Button>
          </div>
        </div>
      </section>

      {/* Beneficiaries */}
      <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
        <div>
          <p className="text-base font-bold">Beneficiaries</p>
          <p className="mt-0.5 text-[13px] text-ink-2">Who the trust can distribute to. At least one.</p>
        </div>

        <div className="flex flex-col gap-2">
          {draft.beneficiaries.map((beneficiary, index) => (
            <div key={beneficiary.key} className="grid grid-cols-[1fr_9rem_2.5rem] items-center gap-2">
              <input
                value={beneficiary.name}
                maxLength={120}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    beneficiaries: draft.beneficiaries.map((b) => (b.key === beneficiary.key ? { ...b, name: event.target.value } : b)),
                  })
                }
                placeholder={`Beneficiary ${index + 1} name`}
                aria-label={`Beneficiary ${index + 1} name`}
                className={inputClass}
              />
              <select
                value={beneficiary.kind}
                aria-label={`Beneficiary ${index + 1} type`}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    beneficiaries: draft.beneficiaries.map((b) =>
                      b.key === beneficiary.key ? { ...b, kind: event.target.value as BeneficiaryKind } : b,
                    ),
                  })
                }
                className={inputClass}
              >
                {BENEFICIARY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BENEFICIARY_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange({ ...draft, beneficiaries: draft.beneficiaries.filter((b) => b.key !== beneficiary.key) })}
                disabled={draft.beneficiaries.length <= 1}
                aria-label={`Remove beneficiary ${index + 1}`}
                className="inline-flex size-10 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-negative disabled:opacity-30"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={draft.beneficiaries.length >= 100}
            onClick={() => onChange({ ...draft, beneficiaries: [...draft.beneficiaries, { key: key(), name: "", kind: "INDIVIDUAL" }] })}
          >
            Add beneficiary
          </Button>
        </div>
      </section>
    </div>
  );
}

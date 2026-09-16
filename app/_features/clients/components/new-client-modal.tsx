"use client";

/**
 * New Client.
 *
 * One step for most entities. A partnership gets a second step for its
 * partners; a unit or discretionary trust one for the trustee and
 * beneficiaries. The client is created at the end of step one, so nothing
 * typed there can be lost; the second step can be skipped and completed
 * later from the entity tab.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient, savePartners, saveTrustDetails } from "@/server/modules/clients/actions";
import { Icon } from "@/ui/icons";
import { Alert, Button, Field, Modal, ModalFooter, Select, cx, submitWith } from "@/ui/primitives";
import { PARTNERS_NOTE, PartnersFields, emptyPartnersDraft, partnersPayload, partnersSummary, type PartnerDraft } from "./partners-fields";
import { TrustDetailsFields, emptyTrustDraft, trustDraftComplete, trustPayload, type TrustDraft } from "./trust-details-fields";

const ENTITIES = [
  { value: "COMPANY", label: "Company" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "SOLE_TRADER", label: "Sole trader" },
  { value: "UNIT_TRUST", label: "Unit trust" },
  { value: "DISCRETIONARY_TRUST", label: "Discretionary trust" },
] as const;

const TRUSTS: ReadonlySet<string> = new Set(["UNIT_TRUST", "DISCRETIONARY_TRUST"]);

type Step = 1 | 2;

export function NewClientModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [gst, setGst] = useState<"yes" | "no">("yes");
  const [entity, setEntity] = useState<string>("");
  const [step, setStep] = useState<Step>(1);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustDraft>(emptyTrustDraft);
  const [partners, setPartners] = useState<PartnerDraft[]>(emptyPartnersDraft);

  const isTrust = TRUSTS.has(entity);
  const isPartnership = entity === "PARTNERSHIP";
  const hasStepTwo = isTrust || isPartnership;
  const stepTwoReady = isTrust ? trustDraftComplete(trust) : partnersSummary(partners).canSave;

  function finish(id: string) {
    onClose();
    router.refresh();
    router.push(`/clients/${id}`);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("gstRegistered", gst);
    startTransition(async () => {
      const result = await createClient(formData);
      if (!result.ok) {
        setError(result.error);
        setField(result.field ?? null);
        return;
      }
      if (result.id && hasStepTwo) {
        setCreatedId(result.id);
        setStep(2);
      } else if (result.id) {
        finish(result.id);
      } else {
        onClose();
        router.refresh();
      }
    });
  }

  function submitStepTwo() {
    if (!createdId) return;
    setError(null);
    startTransition(async () => {
      const result = isTrust
        ? await saveTrustDetails(createdId, trustPayload(trust))
        : await savePartners(createdId, partnersPayload(partners));
      if (result.ok) finish(createdId);
      else setError(result.error);
    });
  }

  const steps = hasStepTwo ? ["Client info", isTrust ? "Trustee & beneficiaries" : "Partners"] : ["Client info"];

  return (
    <Modal
      open={open}
      onClose={step === 2 && createdId ? () => finish(createdId) : onClose}
      title="New Client"
      size="lg"
    >
      {steps.length > 1 ? (
        <ol className="flex gap-3 px-5 pt-4" aria-label="Progress">
          {steps.map((label, index) => {
            const number = (index + 1) as Step;
            const done = number < step;
            const current = number === step;
            return (
              <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={cx("h-1.5 rounded-full", done || current ? "bg-accent-gradient" : "bg-sunken")} />
                <span className={cx("flex items-center gap-1.5 text-[12px] font-semibold", current ? "text-accent-ink" : "text-ink-3")}>
                  {done ? <Icon name="check" className="size-3.5 text-positive" /> : null}
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {step === 1 ? (
        <form onSubmit={submitWith(handleSubmit)}>
          <div className="flex flex-col gap-5 px-5 py-5">
            {error ? <Alert tone="negative">{error}</Alert> : null}
            <div className="flex flex-col gap-5 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
              <p className="text-base font-bold">Business Info</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Business name"
                  name="businessName"
                  required
                  placeholder="e.g. Horizon Trade Services"
                  error={field === "businessName" ? error ?? undefined : undefined}
                />
                <Field
                  label="ABN"
                  name="abn"
                  required
                  inputMode="numeric"
                  placeholder="XX XXX XXX XXX"
                  hint="Eleven digits."
                  error={field === "abn" ? error ?? undefined : undefined}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Is this client currently registered for GST?</span>
                <div role="radiogroup" aria-label="GST registration" className="grid grid-cols-2 gap-3 sm:max-w-xs">
                  {(["yes", "no"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={gst === value}
                      onClick={() => setGst(value)}
                      className={cx(
                        "h-11 rounded-control border text-sm font-medium capitalize transition-colors",
                        gst === value
                          ? "border-accent bg-accent-soft text-accent-ink"
                          : "border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink",
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-ink-3">
                  GST registration drives the tax treatment applied to this client&rsquo;s coding.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business industry" name="industry" placeholder="e.g. Construction" />
                <Select
                  label="Business entity"
                  name="entityType"
                  required
                  value={entity}
                  onChange={(event) => setEntity(event.target.value)}
                >
                  <option value="">Select business entity</option>
                  {ENTITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Entity choice reshapes the form — it drives the equity accounts
                  this client's chart of accounts will need. */}
              {entity === "COMPANY" ? (
                <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
                  <Field
                    label="Income tax rate (%)"
                    name="incomeTaxRatePercent"
                    type="number"
                    defaultValue="25"
                    hint="25% is the base rate entity company rate."
                  />
                </div>
              ) : null}

              {entity === "UNIT_TRUST" ? (
                <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
                  <Field label="Total units" name="totalUnits" type="number" />
                  <Field
                    label="Value per unit (cents)"
                    name="unitValueCents"
                    type="number"
                    hint="Integer cents — never a decimal dollar amount."
                  />
                </div>
              ) : null}

              {hasStepTwo ? (
                <p className="border-t border-rule pt-4 text-xs leading-relaxed text-ink-3">
                  {isTrust ? "The trustee and beneficiaries come next." : "The partners and their shares come next."} They can also be added later from the client&rsquo;s entity tab.
                </p>
              ) : null}
            </div>
          </div>

          <ModalFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" icon={hasStepTwo ? "arrow-right" : "check"} disabled={pending}>
              {pending ? "Saving…" : hasStepTwo ? "Save & continue" : "Save"}
            </Button>
          </ModalFooter>
        </form>
      ) : (
        <>
          <div className="flex flex-col gap-5 px-5 py-5">
            {error ? <Alert tone="negative">{error}</Alert> : null}
            {isTrust ? (
              <TrustDetailsFields draft={trust} onChange={setTrust} />
            ) : (
              <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
                <div>
                  <p className="text-base font-bold">Partners</p>
                  <p className="mt-0.5 text-[13px] text-ink-2">Each partner&rsquo;s share of the partnership&rsquo;s profit. The shares must add up to exactly 100%.</p>
                </div>
                <PartnersFields drafts={partners} onChange={setPartners} />
              </section>
            )}
          </div>
          <ModalFooter note={stepTwoReady ? undefined : isTrust ? "The trustee needs a name, and every beneficiary needs one too." : PARTNERS_NOTE}>
            <Button variant="secondary" onClick={() => createdId && finish(createdId)} disabled={pending}>
              Skip for now
            </Button>
            <Button icon="check" onClick={submitStepTwo} disabled={!stepTwoReady || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

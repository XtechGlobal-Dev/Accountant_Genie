"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/server/modules/clients/actions";
import { Alert, Button, Field, Modal, ModalFooter, Select, cx } from "@/ui/primitives";

const ENTITIES = [
  { value: "COMPANY", label: "Company" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "SOLE_TRADER", label: "Sole trader" },
  { value: "UNIT_TRUST", label: "Unit trust" },
  { value: "DISCRETIONARY_TRUST", label: "Discretionary trust" },
] as const;

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

  function handleSubmit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("gstRegistered", gst);
    startTransition(async () => {
      const result = await createClient(formData);
      if (result.ok) {
        onClose();
        router.refresh();
        if (result.id) router.push(`/clients/${result.id}`);
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Client"
      size="lg"
    >
      <form action={handleSubmit}>
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
              inputMode="numeric"
              placeholder="XX XXX XXX XXX"
              hint="Eleven digits. Leave blank if the client is not registered."
              error={field === "abn" ? error ?? undefined : undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">
              Is this client currently registered for GST?
            </span>
            <div
              role="radiogroup"
              aria-label="GST registration"
              className="grid grid-cols-2 gap-3 sm:max-w-xs"
            >
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
                name="incomeTaxRate"
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
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" icon="check" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

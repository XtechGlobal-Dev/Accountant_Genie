"use client";

/**
 * Edit a client's standing details.
 *
 * The form mirrors the shape of the record: business facts first, then the tax
 * profile, then whatever the chosen entity type adds. Entity choice reshapes
 * the form because it reshapes the equity accounts the client will need.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClient } from "@/server/modules/clients/actions";
import {
  Alert,
  Button,
  Field,
  Modal,
  ModalFooter,
  Select,
  cx,
} from "@/ui/primitives";
import type { ClientDetail } from "@/shared/contracts/client";

const ENTITIES = [
  { value: "COMPANY", label: "Company" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "SOLE_TRADER", label: "Sole trader" },
  { value: "UNIT_TRUST", label: "Unit trust" },
  { value: "DISCRETIONARY_TRUST", label: "Discretionary trust" },
] as const;

export function EditClientButton({ client }: { client: ClientDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon="pen" onClick={() => setOpen(true)}>
        Edit details
      </Button>
      <EditClientModal client={client} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function EditClientModal({
  client,
  open,
  onClose,
}: {
  client: ClientDetail;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [gst, setGst] = useState<"yes" | "no">(client.gstRegistered ? "yes" : "no");
  const [entity, setEntity] = useState<string>(client.entityType);

  function handleSubmit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("gstRegistered", gst);
    startTransition(async () => {
      const result = await updateClient(client.id, formData);
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
      open={open}
      onClose={onClose}
      title="Edit client"
      description="These details drive how this client's transactions are coded and reported."
      size="lg"
    >
      <form action={handleSubmit}>
        <div className="flex flex-col gap-5 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Business name"
              name="businessName"
              required
              defaultValue={client.businessName}
              error={errorFor("businessName")}
            />
            <Field
              label="Legal name"
              name="legalName"
              defaultValue={client.legalName ?? ""}
              hint="If it differs from the trading name."
              error={errorFor("legalName")}
            />
            <Field
              label="ABN"
              name="abn"
              inputMode="numeric"
              defaultValue={client.abn ?? ""}
              placeholder="XX XXX XXX XXX"
              hint="Eleven digits."
              error={errorFor("abn")}
            />
            <Field
              label="Industry"
              name="industry"
              defaultValue={client.industry ?? ""}
              placeholder="e.g. Construction"
              error={errorFor("industry")}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={client.email ?? ""}
              autoComplete="off"
              error={errorFor("email")}
            />
            <Field
              label="Phone"
              name="phone"
              defaultValue={client.phone ?? ""}
              autoComplete="off"
              error={errorFor("phone")}
            />
          </div>

          <div className="flex flex-col gap-4 border-t border-rule pt-5">
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
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Business entity"
                name="entityType"
                required
                value={entity}
                onChange={(event) => setEntity(event.target.value)}
              >
                {ENTITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select
                label="GST basis"
                name="gstBasis"
                defaultValue={client.gstBasis}
                disabled={gst === "no"}
              >
                <option value="CASH">Cash</option>
                <option value="ACCRUAL">Accruals</option>
              </Select>
              <Select
                label="BAS frequency"
                name="basFrequency"
                defaultValue={client.basFrequency}
                disabled={gst === "no"}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </div>
            {gst === "no" ? (
              // Disabled inputs post nothing, so the stored values are sent
              // explicitly rather than silently reset to the schema default.
              <>
                <input type="hidden" name="gstBasis" value={client.gstBasis} />
                <input type="hidden" name="basFrequency" value={client.basFrequency} />
                <p className="text-xs text-ink-3">
                  Basis and reporting cycle apply once the client is registered.
                </p>
              </>
            ) : null}
          </div>

          {entity === "COMPANY" ? (
            <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
              <Field
                label="Income tax rate (%)"
                name="incomeTaxRate"
                type="number"
                defaultValue={String(client.incomeTaxRate ?? 25)}
                hint="25% is the base rate entity company rate."
                error={errorFor("incomeTaxRate")}
              />
            </div>
          ) : null}

          {entity === "UNIT_TRUST" ? (
            <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
              <Field
                label="Total units"
                name="totalUnits"
                type="number"
                defaultValue={client.totalUnits === null ? "" : String(client.totalUnits)}
                error={errorFor("totalUnits")}
              />
              <Field
                label="Value per unit (cents)"
                name="unitValueCents"
                type="number"
                defaultValue={
                  client.unitValueCents === null ? "" : String(client.unitValueCents)
                }
                hint="Integer cents — never a decimal dollar amount."
                error={errorFor("unitValueCents")}
              />
            </div>
          ) : null}
        </div>

        <ModalFooter
          note={
            entity !== client.entityType
              ? "Changing the entity type clears the previous type's fields."
              : undefined
          }
        >
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

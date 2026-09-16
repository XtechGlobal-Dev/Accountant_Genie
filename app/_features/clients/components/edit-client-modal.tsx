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
  submitWith,
} from "@/ui/primitives";
import type { ClientDetail } from "@/shared/contracts/client";
import { Icon } from "@/ui/icons";

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
      icon="users"
      title="Edit client"
      description="These details drive how this client's transactions are coded and reported."
      size="lg"
    >
      <form onSubmit={submitWith(handleSubmit)}>
        {/* The row version this form opened with. A colleague's save in the
            meantime makes this stale, and the server refuses the edit rather
            than overwriting theirs. */}
        <input type="hidden" name="version" value={client.version} />
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Business name"
              name="businessName"
              required
              icon="building"
              defaultValue={client.businessName}
              error={errorFor("businessName")}
            />
            <Field
              label="Legal name"
              name="legalName"
              defaultValue={client.legalName ?? ""}
              placeholder="Enter legal name"
              hint="If it differs from the trading name."
              error={errorFor("legalName")}
            />
            <Field
              label="ABN"
              name="abn"
              required
              icon="hash"
              inputMode="numeric"
              defaultValue={client.abn ?? ""}
              placeholder="XX XXX XXX XXX"
              hint="Eleven digits."
              error={errorFor("abn")}
            />
            <Field
              label="Industry"
              name="industry"
              icon="briefcase"
              defaultValue={client.industry ?? ""}
              placeholder="e.g. Construction"
              error={errorFor("industry")}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              icon="mail"
              defaultValue={client.email ?? ""}
              placeholder="name@business.com.au"
              autoComplete="off"
              error={errorFor("email")}
            />
            <Field
              label="Phone"
              name="phone"
              icon="phone"
              defaultValue={client.phone ?? ""}
              placeholder="Enter phone number"
              autoComplete="off"
              error={errorFor("phone")}
            />
          </div>

          {/* GST registration: the one answer that changes how every line is coded, so it gets its own panel. */}
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-accent-soft/50 px-4 py-3.5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
              <Icon name="shield-check" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Is this client currently registered for GST?</p>
              <p className="mt-0.5 text-[12px] text-ink-2">This decides the tax treatment applied to the client&rsquo;s coding.</p>
            </div>
            <div role="radiogroup" aria-label="GST registration" className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[13rem]">
              {(["yes", "no"] as const).map((value) => {
                const active = gst === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setGst(value)}
                    className={cx(
                      "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold capitalize transition-colors",
                      active
                        ? "border-accent bg-surface text-accent-ink shadow-xs"
                        : "border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink",
                    )}
                  >
                    <span className={cx("inline-flex size-4 items-center justify-center rounded-full border", active ? "border-accent" : "border-rule-strong")}>
                      {active ? <span className="size-2 rounded-full bg-accent" /> : null}
                    </span>
                    {value}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Business entity"
              name="entityType"
              required
              icon="building"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            >
              {ENTITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select label="GST basis" name="gstBasis" icon="coins" defaultValue={client.gstBasis} disabled={gst === "no"}>
              <option value="CASH">Cash</option>
              <option value="ACCRUAL">Accruals</option>
            </Select>
            <Select label="BAS frequency" name="basFrequency" icon="calendar" defaultValue={client.basFrequency} disabled={gst === "no"}>
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
              <p className="-mt-3 text-xs text-ink-3">Basis and reporting cycle apply once the client is registered.</p>
            </>
          ) : null}

          {entity === "COMPANY" ? (
            <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
              <Field
                label="Income tax rate (%)"
                name="incomeTaxRatePercent"
                type="number"
                icon="percent"
                defaultValue={String(client.incomeTaxRatePercent ?? 25)}
                hint="25% is the base rate entity company rate."
                error={errorFor("incomeTaxRatePercent")}
              />
            </div>
          ) : null}

          {entity === "UNIT_TRUST" ? (
            <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-2">
              <Field
                label="Total units"
                name="totalUnits"
                type="number"
                icon="layers"
                defaultValue={client.totalUnits === null ? "" : String(client.totalUnits)}
                error={errorFor("totalUnits")}
              />
              <Field
                label="Value per unit (cents)"
                name="unitValueCents"
                type="number"
                icon="coins"
                defaultValue={client.unitValueCents === null ? "" : String(client.unitValueCents)}
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
          <Button type="submit" icon="save" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

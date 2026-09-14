"use client";

/**
 * The subcontractor register. Payments are linked to a subcontractor when a
 * transaction is recoded or a journal line is posted; the TPAR sums them.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSubcontractor,
  setSubcontractorActive,
  updateSubcontractor,
} from "@/server/modules/subcontractors/actions";
import type { SubcontractorRow } from "@/shared/contracts/register";
import { abn as formatAbn } from "@/shared/format";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  Modal,
  ModalFooter,
  PageHeader,
} from "@/ui/primitives";

type Editing = { mode: "new" } | { mode: "edit"; row: SubcontractorRow } | null;

export function SubcontractorsView({ clientId, rows }: { clientId: string; rows: SubcontractorRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(row: SubcontractorRow) {
    setBusy(row.id);
    await setSubcontractorActive(clientId, row.id, !row.isActive);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Subcontractors"
        context="Who the client pays for building and construction services. The Taxable Payments Annual Report sums the payments linked to each one."
        action={
          <>
            <ButtonLink variant="secondary" icon="file-text" href={`/clients/${clientId}/reports/tpar`}>
              TPAR
            </ButtonLink>
            <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
              Add subcontractor
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="hard-hat"
          title="Add Subcontractors"
          body="Add subcontractors to keep track of your TPAR. Link their payments when reviewing transactions and the report writes itself."
          action={
            <Button size="lg" icon="plus" className="rounded-full" onClick={() => setEditing({ mode: "new" })}>
              Add Your First Subcontractor
            </Button>
          }
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="w-40">ABN</th>
                <th className="w-56">Contact</th>
                <th className="w-28 text-right">Payments</th>
                <th className="w-40 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isActive ? undefined : "opacity-60"}>
                  <td>
                    <span className="font-medium">{row.name}</span>
                    {!row.isActive ? <Badge tone="neutral" className="ml-2">Inactive</Badge> : null}
                    {row.address ? <span className="block text-xs text-ink-3">{row.address}</span> : null}
                  </td>
                  <td className="figure text-ink-2">{row.abn ? formatAbn(row.abn) : <Badge tone="warning">No ABN</Badge>}</td>
                  <td className="text-ink-2">
                    {row.email ?? "—"}
                    {row.phone ? <span className="block text-xs text-ink-3">{row.phone}</span> : null}
                  </td>
                  <td className="figure text-right text-ink-2">{row.paymentCount}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", row })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => toggle(row)}>
                        {row.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <SubcontractorModal
          key={editing.mode === "edit" ? editing.row.id : "new"}
          clientId={clientId}
          row={editing.mode === "edit" ? editing.row : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function SubcontractorModal({
  clientId,
  row,
  onClose,
}: {
  clientId: string;
  row: SubcontractorRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = row
        ? await updateSubcontractor(clientId, row.id, formData)
        : await createSubcontractor(clientId, formData);
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
    <Modal open onClose={onClose} title={row ? "Edit subcontractor" : "New subcontractor"} description="Name and ABN are what the TPAR reports." size="lg">
      <form action={submit}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required defaultValue={row?.name ?? ""} error={errorFor("name")} />
            <Field label="ABN" name="abn" inputMode="numeric" defaultValue={row?.abn ?? ""} placeholder="XX XXX XXX XXX" hint="Eleven digits. Required on the TPAR." error={errorFor("abn")} />
            <Field label="Email" name="email" type="email" defaultValue={row?.email ?? ""} error={errorFor("email")} />
            <Field label="Phone" name="phone" defaultValue={row?.phone ?? ""} error={errorFor("phone")} />
          </div>
          <Field label="Address" name="address" defaultValue={row?.address ?? ""} error={errorFor("address")} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : row ? "Save changes" : "Add subcontractor"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

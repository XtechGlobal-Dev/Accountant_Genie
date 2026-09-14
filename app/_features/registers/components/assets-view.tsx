"use client";

/**
 * The asset register. Depreciation is computed by the schedule report from
 * what is recorded here — cost, date, method, life, private use — and never
 * stored, so a rule change reproduces cleanly.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAsset, disposeAsset, updateAsset } from "@/server/modules/assets/actions";
import type { AccountOption } from "@/shared/contracts/account";
import type { AssetRow } from "@/shared/contracts/register";
import { shortDate } from "@/shared/format";
import { basisPointsToInput, centsToInput, formatBasisPoints } from "@/shared/money";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Select,
} from "@/ui/primitives";

type Editing = { mode: "new" } | { mode: "edit"; row: AssetRow } | { mode: "dispose"; row: AssetRow } | null;

function lifeYears(months: number): string {
  return centsToInput(Math.round((months * 100) / 12));
}

export function AssetsView({ clientId, rows, accounts }: { clientId: string; rows: AssetRow[]; accounts: AccountOption[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assets"
        context="What the client owns and depreciates. The schedule report derives each year's decline in value from this register."
        action={
          <>
            <ButtonLink variant="secondary" icon="trending-down" href={`/clients/${clientId}/reports/depreciation`}>
              Depreciation schedule
            </ButtonLink>
            <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
              Add asset
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="No assets yet"
          body="Record each depreciable asset with its cost, purchase date, method and effective life. Private use reduces the deductible share."
          action={
            <Button icon="plus" onClick={() => setEditing({ mode: "new" })}>
              Add asset
            </Button>
          }
        />
      ) : (
        <div className="sheet overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="w-28">Purchased</th>
                <th className="w-32 text-right">Cost</th>
                <th className="w-32">Method</th>
                <th className="w-24 text-right">Life</th>
                <th className="w-24 text-right">Private</th>
                <th className="w-40">Account</th>
                <th className="w-40 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.disposedAt ? "opacity-60" : undefined}>
                  <td>
                    <span className="font-medium">{row.name}</span>
                    {row.disposedAt ? (
                      <Badge tone="neutral" className="ml-2">
                        Disposed {shortDate(row.disposedAt)}
                      </Badge>
                    ) : null}
                    {row.description ? <span className="block text-xs text-ink-3">{row.description}</span> : null}
                  </td>
                  <td className="figure text-ink-2">{shortDate(row.purchaseDate)}</td>
                  <td className="text-right">
                    <Money cents={row.costCents} />
                  </td>
                  <td className="text-ink-2">{row.method === "PRIME_COST" ? "Prime cost" : "Diminishing value"}</td>
                  <td className="figure text-right text-ink-2">{lifeYears(row.effectiveLifeMonths)} yrs</td>
                  <td className="figure text-right text-ink-2">{formatBasisPoints(row.privateUseBasisPoints)}</td>
                  <td className="text-ink-2">{row.accountName ?? "—"}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", row })}>
                        Edit
                      </Button>
                      {!row.disposedAt ? (
                        <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "dispose", row })}>
                          Dispose
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && editing.mode !== "dispose" ? (
        <AssetModal
          key={editing.mode === "edit" ? editing.row.id : "new"}
          clientId={clientId}
          row={editing.mode === "edit" ? editing.row : null}
          accounts={assetAccounts}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing && editing.mode === "dispose" ? (
        <DisposeModal key={`dispose-${editing.row.id}`} clientId={clientId} row={editing.row} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function useFormAction(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  function run(work: () => Promise<{ ok: boolean; error?: string; field?: string }>) {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong");
        setField(result.field ?? null);
      }
    });
  }
  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);
  return { pending, error, field, run, errorFor };
}

function AssetModal({ clientId, row, accounts, onClose }: { clientId: string; row: AssetRow | null; accounts: AccountOption[]; onClose: () => void }) {
  const form = useFormAction(onClose);
  return (
    <Modal open onClose={onClose} title={row ? "Edit asset" : "New asset"} description="Cost, date, method and effective life drive the depreciation schedule." size="lg">
      <form action={(data) => form.run(() => (row ? updateAsset(clientId, row.id, data) : createAsset(clientId, data)))}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {form.error && !form.field ? <Alert tone="negative">{form.error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset" name="name" required defaultValue={row?.name ?? ""} placeholder="e.g. Toyota HiLux" error={form.errorFor("name")} />
            <Field label="Description" name="description" defaultValue={row?.description ?? ""} error={form.errorFor("description")} />
            <Field label="Cost (GST exclusive)" name="cost" required inputMode="decimal" defaultValue={row ? centsToInput(row.costCents) : ""} placeholder="0.00" error={form.errorFor("costCents")} />
            <Field label="Purchase date" name="purchaseDate" required type="date" defaultValue={row ? row.purchaseDate.toISOString().slice(0, 10) : ""} error={form.errorFor("purchaseDate")} />
            <Select label="Method" name="method" defaultValue={row?.method ?? "DIMINISHING_VALUE"} hint="Diminishing value front-loads the decline; prime cost spreads it evenly.">
              <option value="DIMINISHING_VALUE">Diminishing value</option>
              <option value="PRIME_COST">Prime cost</option>
            </Select>
            <Field label="Effective life (years)" name="effectiveLifeYears" required inputMode="decimal" defaultValue={row ? lifeYears(row.effectiveLifeMonths) : ""} placeholder="e.g. 8" hint="From the ATO's effective life tables, or self-assessed." error={form.errorFor("effectiveLifeMonths")} />
            <Field label="Private use (%)" name="privateUsePercent" inputMode="decimal" defaultValue={row ? basisPointsToInput(row.privateUseBasisPoints) : ""} placeholder="0" hint="Reduces the deductible share, not the decline." error={form.errorFor("privateUseBasisPoints")} />
            <Select label="Is it a car?" name="isCar" defaultValue={row?.isCar ? "yes" : "no"} hint="The car limit applies once the tax advisor has verified it.">
              <option value="no">No</option>
              <option value="yes">Yes — a car</option>
            </Select>
            <Select label="Balance sheet account" name="accountId" defaultValue={row?.accountId ?? ""} error={form.errorFor("accountId")}>
              <option value="">Not linked</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={form.pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.pending}>
            {form.pending ? "Saving…" : row ? "Save changes" : "Add asset"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function DisposeModal({ clientId, row, onClose }: { clientId: string; row: AssetRow; onClose: () => void }) {
  const form = useFormAction(onClose);
  return (
    <Modal open onClose={onClose} title={`Dispose of ${row.name}`} description="The asset stays on the register; depreciation stops at the disposal date.">
      <form action={(data) => form.run(() => disposeAsset(clientId, row.id, data))}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {form.error && !form.field ? <Alert tone="negative">{form.error}</Alert> : null}
          <Field label="Disposal date" name="disposedAt" required type="date" error={form.errorFor("disposedAt")} />
          <Field label="Proceeds" name="proceeds" inputMode="decimal" placeholder="0.00" hint="Sale price, or blank if scrapped." error={form.errorFor("disposalCents")} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={form.pending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={form.pending}>
            {form.pending ? "Saving…" : "Record disposal"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

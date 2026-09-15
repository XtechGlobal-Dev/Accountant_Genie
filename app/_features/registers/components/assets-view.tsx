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
import { ASSET_CATEGORY_LABELS } from "@/shared/labels";
import { Icon } from "@/ui/icons";
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
  submitWith,
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
                <th className="w-44">Category</th>
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
                  <td>
                    <Badge tone="outline">{ASSET_CATEGORY_LABELS[row.category]}</Badge>
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
                    <span className="inline-flex items-center gap-2">
                      <Button variant="secondary" size="sm" icon="pen" onClick={() => setEditing({ mode: "edit", row })}>
                        Edit
                      </Button>
                      {!row.disposedAt ? (
                        <Button variant="secondary" size="sm" icon="archive" onClick={() => setEditing({ mode: "dispose", row })}>
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

const CATEGORIES = Object.entries(ASSET_CATEGORY_LABELS) as [keyof typeof ASSET_CATEGORY_LABELS, string][];

/**
 * The yearly rate the schedule will apply, from the method and the effective
 * life — the ATO's formulas for assets acquired after 10 May 2006, the same
 * ones `depreciation.ts` uses. Shown, never stored: it is derived.
 */
function rateFor(method: string, years: string): string | null {
  const life = Number(years);
  if (!Number.isFinite(life) || life <= 0) return null;
  return ((method === "PRIME_COST" ? 100 : 200) / life).toFixed(2);
}

function AssetModal({ clientId, row, accounts, onClose }: { clientId: string; row: AssetRow | null; accounts: AccountOption[]; onClose: () => void }) {
  const form = useFormAction(onClose);
  const [preview, setPreview] = useState<{ method: string; years: string }>({ method: row?.method ?? "DIMINISHING_VALUE", years: row ? lifeYears(row.effectiveLifeMonths) : "" });
  const rate = rateFor(preview.method, preview.years);

  return (
    <Modal
      open
      onClose={onClose}
      icon="calculator"
      title={row ? "Edit asset" : "Add new asset"}
      description="Cost, date, method and effective life drive the depreciation schedule. Private use reduces the deductible share."
      size="lg"
    >
      <form
        onChange={(event) => {
          const data = new FormData(event.currentTarget);
          setPreview({ method: String(data.get("method") ?? "DIMINISHING_VALUE"), years: String(data.get("effectiveLifeYears") ?? "") });
        }}
        onSubmit={submitWith((data) => form.run(() => (row ? updateAsset(clientId, row.id, data) : createAsset(clientId, data))))}
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
          {form.error && !form.field ? <Alert tone="negative">{form.error}</Alert> : null}

          <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-xs">
            <p className="text-base font-bold">Depreciation</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asset name" name="name" required defaultValue={row?.name ?? ""} placeholder="e.g. Office computer" error={form.errorFor("name")} />
              <Select label="Category" name="category" required defaultValue={row?.category ?? ""} icon="layers" error={form.errorFor("category")}>
                <option value="" disabled>
                  Select
                </option>
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>

              <Field label="Total cost" name="totalCost" inputMode="decimal" prefix="$" defaultValue={row?.totalCostCents === null || row?.totalCostCents === undefined ? "" : centsToInput(row.totalCostCents)} placeholder="0.00" hint="What was paid, GST included." error={form.errorFor("totalCostCents")} />
              <Field label="Acquisition cost" name="cost" required inputMode="decimal" prefix="$" defaultValue={row ? centsToInput(row.costCents) : ""} placeholder="0.00" hint="The depreciable cost — GST exclusive when the client claims the credit." error={form.errorFor("costCents")} />

              <Field label="GST" name="gst" inputMode="decimal" prefix="$" defaultValue={row?.gstCents === null || row?.gstCents === undefined ? "" : centsToInput(row.gstCents)} placeholder="0.00" error={form.errorFor("gstCents")} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink">Rate of depreciation</span>
                <div className="flex h-[2.75rem] items-center justify-between rounded-xl border border-rule bg-sunken px-3.5 text-sm">
                  <span className={rate ? "figure text-ink" : "text-ink-3"}>{rate ?? "Set the method and effective life"}</span>
                  <span className="font-medium text-ink-3">%</span>
                </div>
                <p className="text-xs leading-relaxed text-ink-3">Per year, from the method and effective life: prime cost 100% ÷ life, diminishing value 200% ÷ life.</p>
              </div>
            </div>

            <Field label="Private use" name="privateUsePercent" inputMode="decimal" suffix="%" defaultValue={row ? basisPointsToInput(row.privateUseBasisPoints) : ""} placeholder="e.g. 50" hint="Reduces the deductible share, not the decline." error={form.errorFor("privateUseBasisPoints")} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Acquisition date" name="purchaseDate" required type="date" icon="calendar" defaultValue={row ? row.purchaseDate.toISOString().slice(0, 10) : ""} error={form.errorFor("purchaseDate")} />
              <Field label="Effective life (years)" name="effectiveLifeYears" required inputMode="decimal" defaultValue={row ? lifeYears(row.effectiveLifeMonths) : ""} placeholder="e.g. 5" hint="From the ATO's effective life tables, or self-assessed." error={form.errorFor("effectiveLifeMonths")} />
            </div>

            <Select label="Depreciation method" name="method" icon="trending-down" defaultValue={row?.method ?? "DIMINISHING_VALUE"} hint="Diminishing value front-loads the decline; prime cost spreads it evenly.">
              <option value="DIMINISHING_VALUE">Diminishing value</option>
              <option value="PRIME_COST">Prime cost</option>
            </Select>

            <div className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
              <Select label="Is it a car?" name="isCar" defaultValue={row?.isCar ? "yes" : "no"} hint="The car limit applies once the tax advisor has verified it.">
                <option value="no">No</option>
                <option value="yes">Yes — a car</option>
              </Select>
              <Select label="Balance sheet account" name="accountId" icon="book-open" defaultValue={row?.accountId ?? ""} error={form.errorFor("accountId")}>
                <option value="">Not linked</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </div>

            <Field label="Description" name="description" defaultValue={row?.description ?? ""} placeholder="Serial number, location, anything worth remembering" error={form.errorFor("description")} />
          </section>

          {row?.disposedAt ? (
            <p className="flex items-center gap-2 text-xs text-ink-3">
              <Icon name="archive" className="size-3.5" />
              Disposed on {shortDate(row.disposedAt)}. Depreciation stopped that day.
            </p>
          ) : null}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={form.pending}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={form.pending}>
            {form.pending ? "Saving…" : row ? "Save changes" : "Save"}
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
      <form onSubmit={submitWith((data) => form.run(() => disposeAsset(clientId, row.id, data)))}>
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

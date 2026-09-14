"use client";

/**
 * Create or edit a firm-created account.
 *
 * The type is chosen first because it narrows the tax codes on offer: an
 * income account cannot be coded "GST on Expenses" here any more than the
 * server would accept it. The rule lives in `@/shared/account-rules`, once,
 * and both ends read it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount, updateAccount } from "@/server/modules/accounts/actions";
import {
  CREATABLE_ACCOUNT_TYPES,
  CUSTOM_ACCOUNT_CODE_CEILING,
  CUSTOM_ACCOUNT_CODE_FLOOR,
  TREATMENTS_BY_TYPE,
  type CreatableAccountType,
} from "@/shared/account-rules";
import type { ChartAccountRow } from "@/shared/contracts/account";
import type { ClientOption } from "@/shared/contracts/client";
import type { GstTreatment } from "@/shared/enums";
import { ACCOUNT_TYPE_LABELS, GST_TREATMENT_LABELS } from "@/shared/labels";
import { Alert, Button, Field, Modal, ModalFooter, Select } from "@/ui/primitives";

export function AccountModal({
  account,
  clients,
  fixedClient,
  onClose,
}: {
  /** Editing an existing custom account; absent when creating. */
  account: ChartAccountRow | null;
  clients: readonly ClientOption[];
  /** When opened from inside a client's workspace, the account is theirs. */
  fixedClient?: { id: string; name: string } | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const initialType: CreatableAccountType =
    account && account.type !== "UNKNOWN" ? account.type : "EXPENSE";
  const [type, setType] = useState<CreatableAccountType>(initialType);
  const allowed = TREATMENTS_BY_TYPE[type];
  const [treatment, setTreatment] = useState<GstTreatment>(
    account && allowed.includes(account.gstTreatment) ? account.gstTreatment : allowed[0]!,
  );

  function changeType(next: CreatableAccountType) {
    setType(next);
    const nextAllowed = TREATMENTS_BY_TYPE[next];
    if (!nextAllowed.includes(treatment)) setTreatment(nextAllowed[0]!);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setField(null);
    if (fixedClient) formData.set("clientId", fixedClient.id);
    startTransition(async () => {
      const result = account
        ? await updateAccount(account.id, formData)
        : await createAccount(formData);
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
  const codeLocked = account !== null && account.postingCount > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? "Edit account" : "New account"}
      description={
        account
          ? "Posted lines keep the tax treatment they were coded under; changes apply from now on."
          : "A firm-created account, added to the Australian default chart."
      }
      size="lg"
    >
      <form action={handleSubmit}>
        <div className="flex flex-col gap-5 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}

          {fixedClient ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Applies to</span>
              <p className="rounded-control border border-rule bg-sunken px-3.5 py-2.5 text-sm">
                {fixedClient.name} only
              </p>
            </div>
          ) : (
            <Select
              label="Applies to"
              name="clientId"
              defaultValue={account?.clientId ?? ""}
              disabled={codeLocked}
              error={errorFor("clientId")}
              hint={
                codeLocked
                  ? "An account with postings stays with the client it was posted for."
                  : "Firm-wide accounts appear in every client's chart."
              }
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.businessName} only
                </option>
              ))}
            </Select>
          )}
          {codeLocked && !fixedClient ? (
            <input type="hidden" name="clientId" value={account?.clientId ?? ""} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field
              label="Account name"
              name="name"
              required
              defaultValue={account?.name ?? ""}
              placeholder="e.g. Software Subscriptions"
              error={errorFor("name")}
            />
            <Field
              label="Code"
              name="code"
              required
              type="number"
              inputMode="numeric"
              defaultValue={account ? String(account.code) : ""}
              placeholder={String(CUSTOM_ACCOUNT_CODE_FLOOR + 500)}
              hint={
                codeLocked
                  ? "Locked: lines have been posted."
                  : `${CUSTOM_ACCOUNT_CODE_FLOOR}–${CUSTOM_ACCOUNT_CODE_CEILING}`
              }
              error={errorFor("code")}
              className={codeLocked ? "pointer-events-none opacity-60" : undefined}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Account type"
              name="type"
              required
              value={type}
              onChange={(event) => changeType(event.target.value as CreatableAccountType)}
              error={errorFor("type")}
            >
              {CREATABLE_ACCOUNT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {ACCOUNT_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>
            <Select
              label="Tax code"
              name="gstTreatment"
              required
              value={treatment}
              onChange={(event) => setTreatment(event.target.value as GstTreatment)}
              error={errorFor("gstTreatment")}
              hint="Only the codes that make sense for this kind of account are offered."
            >
              {allowed.map((option) => (
                <option key={option} value={option}>
                  {GST_TREATMENT_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>

          <Field
            label="Description"
            name="description"
            defaultValue={account?.description ?? ""}
            placeholder="What gets coded here, for the next person"
            error={errorFor("description")}
          />
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : account ? "Save changes" : "Add account"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

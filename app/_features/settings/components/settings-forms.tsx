"use client";

/**
 * Edit dialogs for the profile and the firm.
 *
 * Both post a FormData to a server action and refresh on success. The email
 * is shown but not editable: it is the sign-in identity, and changing it is a
 * verification flow that arrives with authentication in Phase 1.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFirm, updateProfile } from "@/server/modules/firms/actions";
import { Alert, Button, Field, Modal, ModalFooter } from "@/ui/primitives";
import type { SettingsView } from "@/shared/contracts/settings";

function useAction(action: (form: FormData) => Promise<{ ok: boolean; error?: string; field?: string }>, onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = await action(form);
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
  return { pending, error, field, submit, errorFor };
}

export function EditProfileButton({ user }: { user: SettingsView["user"] }) {
  const [open, setOpen] = useState(false);
  const form = useAction(updateProfile, () => setOpen(false));

  return (
    <>
      <Button variant="secondary" size="sm" icon="pen" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit profile"
        description="How your name appears on journals you post and in the audit trail."
      >
        <form action={form.submit}>
          <div className="flex flex-col gap-5 px-5 py-5">
            {form.error && !form.field ? <Alert tone="negative">{form.error}</Alert> : null}
            <Field
              label="Name"
              name="name"
              required
              defaultValue={user.name}
              error={form.errorFor("name")}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Email</span>
              <p className="rounded-control border border-rule bg-sunken px-3.5 py-2.5 text-sm text-ink-2">
                {user.email}
              </p>
              <p className="text-xs leading-relaxed text-ink-3">
                Your sign-in identity. Changing it needs verification, which arrives with
                authentication.
              </p>
            </div>
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={form.pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Save"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}

export function EditFirmButton({ firm }: { firm: SettingsView["firm"] }) {
  const [open, setOpen] = useState(false);
  const form = useAction(updateFirm, () => setOpen(false));

  return (
    <>
      <Button variant="secondary" size="sm" icon="pen" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit firm"
        description="The practice these books belong to."
      >
        <form action={form.submit}>
          <div className="flex flex-col gap-5 px-5 py-5">
            {form.error && !form.field ? <Alert tone="negative">{form.error}</Alert> : null}
            <Field
              label="Firm name"
              name="name"
              required
              defaultValue={firm.name}
              error={form.errorFor("name")}
            />
            <Field
              label="ABN"
              name="abn"
              inputMode="numeric"
              defaultValue={firm.abn ?? ""}
              placeholder="XX XXX XXX XXX"
              hint="Eleven digits."
              error={form.errorFor("abn")}
            />
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={form.pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Save"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}

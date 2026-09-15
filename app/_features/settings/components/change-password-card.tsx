"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/server/modules/auth/actions";
import { Alert, Button, Card, CardHeader, PasswordField, submitWith } from "@/ui/primitives";

/** Change the signed-in person's password. Other sessions stay; a reset signs them all out. */
export function ChangePasswordCard({ required }: { required: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    setDone(false);
    startTransition(async () => {
      const result = await changePassword(formData);
      if (result.ok) {
        setDone(true);
        formRef.current?.reset();
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }
  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);

  return (
    <Card>
      <CardHeader icon="shield" title="Password" description="Keep your account secure. Never share it or keep it in email." />
      <form ref={formRef} onSubmit={submitWith(submit)} className="flex flex-col gap-3 px-5 py-4">
        {required ? (
          <Alert tone="warning" title="Choose a new password to continue">
            You signed in with a temporary password. Set your own before doing anything else.
          </Alert>
        ) : null}
        {error && !field ? <Alert tone="negative">{error}</Alert> : null}
        {done ? <Alert tone="positive">Password changed.</Alert> : null}
        <PasswordField label="Current password" name="current" placeholder="Enter current password" autoComplete="current-password" error={errorFor("current")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <PasswordField label="New password" name="password" autoComplete="new-password" error={errorFor("password")} />
          <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" error={errorFor("confirm")} />
        </div>
        <p className="-mt-1 text-xs text-ink-3">At least 10 characters.</p>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

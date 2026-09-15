"use client";

/**
 * The one form every sign-in step uses. Submits to a server action, shows
 * its error, and lets the action redirect on success. Nothing about a
 * password or a code is kept in component state.
 *
 * Children are plain elements: a server page composes the fields, and this
 * component adds the submit, the error and the pending state around them.
 */

import { useState, useTransition, type ReactNode } from "react";
import type { AuthFormResult } from "@/server/modules/auth/actions";
import { Alert, Button, submitWith } from "@/ui/primitives";

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  password: "Password",
  code: "Verification code",
  firmName: "Firm name",
  name: "Name",
};

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: (formData: FormData) => Promise<AuthFormResult>;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        const label = result.field ? FIELD_LABELS[result.field] : undefined;
        setError(label ? `${label}: ${result.error}` : result.error);
      } else if (result.note) {
        setNote(result.note);
      }
    });
  }

  return (
    <form onSubmit={submitWith(submit)} className="flex flex-col gap-4">
      {error ? <Alert tone="negative">{error}</Alert> : null}
      {note ? <Alert tone="info">{note}</Alert> : null}
      {children}
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

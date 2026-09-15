"use client";

/**
 * Add a standing note to a client, inline on the overview.
 *
 * Collapsed to a single button until it is wanted: the notes that matter are
 * written once and read many times, so reading is the default state.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addClientNote } from "@/server/modules/clients/actions";
import { Alert, Button, Field, cx, inputClass, submitWith } from "@/ui/primitives";

export function AddNoteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addClientNote(clientId, formData);
      if (result.ok) {
        formRef.current?.reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" icon="plus" onClick={() => setOpen(true)}>
        Add note
      </Button>
    );
  }

  return (
    <form ref={formRef} onSubmit={submitWith(handleSubmit)} className="flex flex-col gap-3">
      {error ? <Alert tone="negative">{error}</Alert> : null}

      <Field label="Title" name="title" required placeholder="e.g. Vehicle private use" />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note-body" className="text-sm font-medium text-ink">
          Note
        </label>
        <textarea
          id="note-body"
          name="body"
          required
          rows={3}
          placeholder="What the next person needs to know before they code this client."
          className={cx(inputClass, "resize-y")}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save note"}
        </Button>
      </div>
    </form>
  );
}

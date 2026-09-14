"use client";

/**
 * Reverse a posted journal.
 *
 * The only correction path. The original stays exactly as posted; a mirror
 * entry is added, linked to it, dated on or after the original.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reverseJournal } from "@/server/modules/ledger/actions";
import { Alert, Button, Modal, ModalFooter, inputClass } from "@/ui/primitives";

export function ReverseJournalButton({
  clientId,
  entryId,
  originalDate,
}: {
  clientId: string;
  entryId: string;
  /** YYYY-MM-DD of the entry being reversed. */
  originalDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(originalDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await reverseJournal(clientId, entryId, { date });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        if (result.id) router.push(`/clients/${clientId}/journals/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" icon="undo" onClick={() => setOpen(true)}>
        Reverse
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reverse this journal"
        description="A mirror-image entry is posted and linked to this one. Nothing already posted changes."
      >
        <div className="flex flex-col gap-4 px-5 py-5">
          {error ? <Alert tone="negative">{error}</Alert> : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reversal-date" className="text-sm font-medium text-ink">
              Reversal date
            </label>
            <input
              id="reversal-date"
              type="date"
              value={date}
              min={originalDate}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
            />
            <p className="text-xs leading-relaxed text-ink-3">
              Same date as the original to undo it within its period; a later date if that
              period has already been reported.
            </p>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={pending || !date}>
            {pending ? "Reversing…" : "Post reversal"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

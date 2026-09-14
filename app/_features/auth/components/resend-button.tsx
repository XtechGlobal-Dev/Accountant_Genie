"use client";

import { useState, useTransition } from "react";
import { resendCode } from "@/server/modules/auth/actions";
import { Button } from "@/ui/primitives";

export function ResendButton() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 text-sm">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await resendCode();
            setNote(result.ok ? (result.note ?? "A new code was sent.") : result.error);
          })
        }
      >
        {pending ? "Sending…" : "Send a new code"}
      </Button>
      {note ? <span className="text-ink-2">{note}</span> : null}
    </div>
  );
}

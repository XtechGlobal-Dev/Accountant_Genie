"use client";

/**
 * Support, from anywhere: a floating button that opens a compact panel with
 * a short form. The Help modal's items open the same panel with a category
 * preselected, through a window event, so the two never need to be siblings.
 */

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { sendSupportRequest } from "@/server/modules/support/actions";
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/server/modules/support/schema";
import { Icon } from "@/ui/icons";
import { Alert, Button, Field, Select, cx, submitWith } from "@/ui/primitives";

const OPEN_EVENT = "ledgerly:open-support";

export function openSupport(category?: SupportCategory) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { category } }));
}

export function SupportWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportCategory>("question");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [sent, setSent] = useState<{ consoleOnly: boolean } | null>(null);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ category?: SupportCategory }>).detail;
      if (detail?.category) setCategory(detail.category);
      setSent(null);
      setError(null);
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("page", typeof window !== "undefined" ? window.location.href : pathname);
    startTransition(async () => {
      const result = await sendSupportRequest(formData);
      if (result.ok) {
        setSent({ consoleOnly: result.consoleOnly === true });
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }

  return (
    <>
      {/* Opened from the headset in the sidebar and from the Help dialog. */}

      {open ? (
        <div
          role="dialog"
          aria-label="Support"
          className="card fixed bottom-24 right-6 z-40 w-[calc(100vw-3rem)] max-w-sm overflow-hidden shadow-pop animate-pop-in"
        >
          <div className="relative overflow-hidden bg-sidebar bg-mesh px-5 py-4 text-white">
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ledger-grid opacity-40" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Support</p>
                <p className="mt-1 text-base font-bold">How can we help?</p>
                <p className="mt-0.5 text-[13px] text-white/70">We reply by email, usually the same business day.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
          </div>

          {sent ? (
            <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-positive-soft text-positive-ink">
                <Icon name="check-circle" className="size-6" />
              </span>
              <p className="text-base font-bold">Sent — thank you</p>
              <p className="text-sm text-ink-2">
                {sent.consoleOnly
                  ? "No email provider is configured in this environment, so the message was written to the server log."
                  : "Your message is with the team. We will reply to your sign-in email."}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={submitWith(submit)} className="flex flex-col gap-3 px-5 py-4">
              {error && !field ? <Alert tone="negative">{error}</Alert> : null}
              <Select label="What is this about?" name="category" value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>
                {SUPPORT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {SUPPORT_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Field label="Subject" name="subject" required placeholder="A short summary" error={field === "subject" ? (error ?? undefined) : undefined} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="support-message" className="text-[13px] font-semibold text-ink">
                  Message
                </label>
                <textarea
                  id="support-message"
                  name="message"
                  required
                  rows={4}
                  placeholder="What happened, or what would help?"
                  aria-invalid={field === "message" ? true : undefined}
                  className="w-full resize-none rounded-xl border border-rule bg-surface px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15 aria-invalid:border-negative"
                />
                {field === "message" && error ? <p className="text-xs font-medium text-negative-ink">{error}</p> : null}
              </div>
              <p className="text-[11px] leading-relaxed text-ink-3">
                Your name, firm and the page you are on are attached automatically. Never include bank credentials.
              </p>
              <Button type="submit" icon="send" disabled={pending} className="w-full">
                {pending ? "Sending…" : "Send message"}
              </Button>
            </form>
          )}
        </div>
      ) : null}
    </>
  );
}

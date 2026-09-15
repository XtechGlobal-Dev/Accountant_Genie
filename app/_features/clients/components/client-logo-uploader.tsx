"use client";

/**
 * The client's logo: shown when there is one, otherwise a drop zone.
 *
 * The file goes to a server action as multipart form data; the server
 * decides from the bytes whether it is an image at all. Nothing is previewed
 * from the local file — what appears after upload is what the server kept.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeClientLogo, uploadClientLogo } from "@/server/modules/clients/actions";
import { Icon } from "@/ui/icons";
import { Button, cx } from "@/ui/primitives";

export function ClientLogoUploader({ clientId, hasLogo, businessName }: { clientId: string; hasLogo: boolean; businessName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // Bumped after every change so the browser refetches the image at the same URL.
  const [version, setVersion] = useState(0);

  function send(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.set("logo", file);
    startTransition(async () => {
      const result = await uploadClientLogo(clientId, form);
      if (result.ok) {
        setVersion((v) => v + 1);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeClientLogo(clientId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {hasLogo ? (
        <span className="inline-flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rule bg-surface-2 p-2 shadow-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, sized by CSS */}
          <img src={`/clients/${clientId}/logo?v=${version}`} alt={`${businessName} logo`} className="max-h-full max-w-full object-contain" />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            send(event.dataTransfer.files[0]);
          }}
          disabled={pending}
          className={cx(
            "flex size-24 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-2 text-center text-[11px] font-semibold leading-tight transition-colors",
            over ? "border-accent bg-accent-soft text-accent-ink" : "border-rule-strong bg-surface-2/60 text-ink-2 hover:border-accent/60 hover:text-accent-ink",
          )}
        >
          <Icon name="upload" className="size-5" />
          {pending ? "Uploading…" : "Drag image or browse"}
        </button>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[13px] text-ink-2">PNG, JPEG or WebP, up to 2 MB. Shown beside the client&rsquo;s name.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon="upload" disabled={pending} onClick={() => input.current?.click()}>
            {hasLogo ? "Replace" : "Browse"}
          </Button>
          {hasLogo ? (
            <Button variant="secondary" size="sm" icon="trash" disabled={pending} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-xs font-medium text-negative-ink">{error}</p> : null}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Choose a logo"
        onChange={(event) => {
          send(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

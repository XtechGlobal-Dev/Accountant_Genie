"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/ui/icons";
import { cx } from "@/ui/styles";

/**
 * Copies one value to the clipboard and says so for a moment. Sits beside
 * identifiers people re-type into other systems: an ABN, an account mask.
 */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string | undefined }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure context, permissions); the value is still on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={cx(
        "inline-flex size-7 items-center justify-center rounded-lg transition-colors",
        copied ? "text-positive" : "text-ink-3 hover:bg-sunken hover:text-ink",
        className,
      )}
    >
      <Icon name={copied ? "check" : "copy"} className="size-3.5" />
    </button>
  );
}

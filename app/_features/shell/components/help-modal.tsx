"use client";

/**
 * Help. Opened from the sidebar; a window event carries the request so the
 * trigger and the dialog need not be siblings. Each item does something:
 * the guides open the in-app documentation, the rest open Support with the
 * right category already chosen.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openSupport } from "@/features/shell/components/support-widget";
import { Icon, type IconName } from "@/ui/icons";
import { Kbd, Modal } from "@/ui/primitives";

const OPEN_EVENT = "ledgerly:open-help";

export function openHelp() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Item = {
  icon: IconName;
  title: string;
  body: string;
  action: { kind: "route"; href: string } | { kind: "support"; category: "question" | "bug" | "feature" | "billing" };
};

const ITEMS: readonly Item[] = [
  {
    icon: "file-text",
    title: "Documentation",
    body: "Step-by-step guides for setup, reconciliation, reports and keyboard shortcuts.",
    action: { kind: "route", href: "/help" },
  },
  {
    icon: "sparkles",
    title: "Suggest a feature",
    body: "Tell us what would make this faster for your firm.",
    action: { kind: "support", category: "feature" },
  },
  {
    icon: "alert-triangle",
    title: "Report a bug",
    body: "Something behaving unexpectedly? Send it through and we'll fix it.",
    action: { kind: "support", category: "bug" },
  },
  {
    icon: "headset",
    title: "Talk to us",
    body: "Reach the team directly for help with any question.",
    action: { kind: "support", category: "question" },
  },
];

const SHORTCUTS: ReadonlyArray<{ keys: string[]; does: string }> = [
  { keys: ["Ctrl", "K"], does: "Command Bar" },
  { keys: ["C"], does: "Command Bar, from anywhere" },
  { keys: ["J", "K"], does: "Move through transactions" },
  { keys: ["A"], does: "Accept the current transaction" },
  { keys: ["Shift", "A"], does: "Accept every selected transaction" },
  { keys: ["R"], does: "Recode" },
  { keys: ["X"], does: "Exclude" },
  { keys: ["Esc"], does: "Close any dialog" },
];

export function HelpModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  function run(item: Item) {
    setOpen(false);
    if (item.action.kind === "route") {
      router.push(item.action.href);
    } else {
      openSupport(item.action.category);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Help & Support"
      description="Guides, feedback and a direct line to the team."
      size="lg"
    >
      <div className="grid gap-5 p-5 md:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-2">
          {ITEMS.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => run(item)}
              className="group flex items-start gap-3 rounded-control border border-rule bg-surface px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/50"
            >
              <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-gradient text-white shadow-glow">
                <Icon name={item.icon} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{item.body}</span>
              </span>
              <Icon name="chevron-right" className="mt-2 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </button>
          ))}
        </div>
        <div className="rounded-control border border-rule bg-surface-2 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">Keyboard</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.does} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink-2">{shortcut.does}</span>
                <span className="flex items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

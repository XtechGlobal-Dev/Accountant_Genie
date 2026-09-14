"use client";

/**
 * Command Bar — Ctrl/Cmd-K from anywhere.
 *
 * An accountant switching between forty clients a day should not have to aim
 * at a sidebar. Clients rank above actions because switching client is the
 * most frequent move in the product; typing narrows both, and a leading `@`
 * restricts the search to clients only.
 *
 * The command list is deliberately limited to routes that exist. Adding a
 * module means adding its entry here, not inventing a destination.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/ui/icons";
import { Portal } from "@/ui/portal";
import { Avatar, Kbd, cx } from "@/ui/primitives";
import type { ClientOption } from "@/shared/contracts/client";

interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly icon?: IconName;
  readonly hint?: string;
  readonly href: string;
}

const OPEN_EVENT = "ledgerly:open-palette";

/** Open the palette from anywhere — the top bar search, a keyboard shortcut. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette({
  clients,
  activeClient,
}: {
  readonly clients: readonly ClientOption[];
  /** The client whose workspace is open, if any — its actions rank first. */
  readonly activeClient?: ClientOption | undefined;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const clientCommands = useMemo<Command[]>(
    () =>
      clients.map((client) => ({
        id: `client-${client.id}`,
        label: client.businessName,
        group: "Clients",
        href: `/clients/${client.id}`,
      })),
    [clients],
  );

  // What you can do inside the open client's workspace. Listed first: when a
  // client is open, the next move is almost always about that client.
  const clientContextCommands = useMemo<Command[]>(() => {
    if (!activeClient) return [];
    const base = `/clients/${activeClient.id}`;
    const group = activeClient.businessName;
    return [
      { id: "ctx-review", label: "Review transactions", group, icon: "receipt", href: `${base}/transactions` },
      { id: "ctx-upload", label: "Upload bank statement", group, icon: "upload", href: `${base}/banks?upload=1` },
      { id: "ctx-journal", label: "New journal entry", group, icon: "plus", href: `${base}/journals?new=1` },
      { id: "ctx-opening", label: "Opening balances", group, icon: "book-open", href: `${base}/journals?opening=1` },
      { id: "ctx-journals", label: "Journals", group, icon: "book-open", href: `${base}/journals` },
      { id: "ctx-pl", label: "Profit & Loss", group, icon: "bar-chart", href: `${base}/reports/profit-and-loss` },
      { id: "ctx-bas", label: "Business Activity Statement", group, icon: "calculator", href: `${base}/reports/bas` },
      { id: "ctx-coa", label: "Client chart of accounts", group, icon: "table", href: `${base}/accounts` },
      { id: "ctx-banks", label: "Bank accounts", group, icon: "landmark", href: `${base}/banks` },
      { id: "ctx-memory", label: "Coding Memory", group, icon: "sparkles", href: `${base}/memory` },
      { id: "ctx-assets", label: "Assets", group, icon: "briefcase", href: `${base}/assets` },
      { id: "ctx-loans", label: "Loans", group, icon: "banknote", href: `${base}/loans` },
      { id: "ctx-subs", label: "Subcontractors", group, icon: "hard-hat", href: `${base}/subcontractors` },
      { id: "ctx-details", label: "Client details", group, icon: "building", href: `${base}/details` },
    ];
  }, [activeClient]);

  const actionCommands = useMemo<Command[]>(
    () => [
      { id: "new-client", label: "Add client", group: "Actions", icon: "plus", href: "/clients?new=1" },
      { id: "all-clients", label: "All clients", group: "Actions", icon: "users", href: "/clients" },
      {
        id: "archived",
        label: "Archived clients",
        group: "Actions",
        icon: "archive",
        href: "/clients?archived=true",
      },
      { id: "home", label: "Home", group: "Go to", icon: "home", href: "/" },
      { id: "coa", label: "Chart of accounts", group: "Go to", icon: "table", href: "/accounts" },
      { id: "memory", label: "Coding Memory", group: "Go to", icon: "sparkles", href: "/memory" },
      { id: "team", label: "Team", group: "Settings", icon: "users", href: "/settings/team" },
      { id: "audit", label: "Audit trail", group: "Settings", icon: "shield-check", href: "/settings/audit" },
      { id: "tax-rules", label: "Tax rules", group: "Settings", icon: "scale", href: "/settings/tax-rules" },
      { id: "help", label: "Help & documentation", group: "Settings", icon: "help-circle", href: "/help" },
      { id: "queue", label: "Transactions across the firm", group: "Go to", icon: "receipt", href: "/transactions" },
      { id: "reconcile", label: "Reconciliation", group: "Go to", icon: "sparkles", href: "/reconcile" },
      { id: "reports", label: "Reports", group: "Go to", icon: "bar-chart", href: "/reports" },
      { id: "settings", label: "Settings", group: "Settings", icon: "settings", href: "/settings" },
      { id: "plan", label: "Plan & usage", group: "Settings", icon: "coins", href: "/settings/plan" },
    ],
    [],
  );

  const matches = useMemo(() => {
    // `@` narrows to clients — the move you make when you already know the name.
    const clientsOnly = query.startsWith("@");
    const needle = (clientsOnly ? query.slice(1) : query).trim().toLowerCase();
    const pool = clientsOnly
      ? clientCommands
      : [...clientContextCommands, ...clientCommands, ...actionCommands];
    if (!needle) return pool.slice(0, 14);
    return pool.filter((command) => command.label.toLowerCase().includes(needle)).slice(0, 14);
  }, [clientContextCommands, clientCommands, actionCommands, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Focus after paint, or the input is not in the document yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    router.push(command.href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(matches[cursor]);
    }
  };

  let lastGroup = "";

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-sm animate-fade-in"
        onClick={() => setOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command Bar"
          onClick={(event) => event.stopPropagation()}
          className="card w-full max-w-xl overflow-hidden shadow-pop animate-pop-in"
        >
          <div className="relative border-b border-rule">
            <Icon
              name="search"
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search clients and actions… or @ a client"
              aria-label="Search clients and actions"
              className="w-full bg-transparent py-3.5 pl-11 pr-4 text-[15px] outline-none placeholder:text-ink-3"
            />
          </div>

          <ul className="max-h-80 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-ink-3">
                Nothing matches &ldquo;{query}&rdquo;
              </li>
            ) : (
              matches.map((command, index) => {
                const showGroup = command.group !== lastGroup;
                lastGroup = command.group;
                const selected = index === cursor;
                return (
                  <li key={command.id}>
                    {showGroup ? (
                      <p className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                        {command.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => run(command)}
                      aria-current={selected ? "true" : undefined}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left text-sm transition-colors",
                        selected ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      {command.group === "Clients" ? (
                        <Avatar name={command.label} size="sm" />
                      ) : (
                        <span
                          className={cx(
                            "inline-flex size-6 items-center justify-center rounded-[6px]",
                            selected ? "bg-accent/15 text-accent" : "bg-sunken text-ink-2",
                          )}
                        >
                          <Icon name={command.icon ?? "arrow-right"} className="size-3.5" />
                        </span>
                      )}
                      <span className="flex-1 truncate">{command.label}</span>
                      {command.hint ? (
                        <span className="shrink-0 text-xs text-ink-3">{command.hint}</span>
                      ) : null}
                      {selected ? (
                        <Icon name="arrow-right" className="size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex gap-4 border-t border-rule bg-surface-2 px-4 py-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>@</Kbd> clients
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd> close
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}

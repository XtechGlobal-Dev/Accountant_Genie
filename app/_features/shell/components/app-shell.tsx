"use client";

/**
 * The application frame.
 *
 * A floating white sidebar carries everything the chrome used to: the brand,
 * the plan, support, the account menu, the Command Bar trigger, the firm's
 * modules, the client list, and — once a client is open — that client's
 * sections as a nested menu. There is no top bar; each page owns its heading.
 *
 * The sidebar lists only routes that exist. An item is added here when its
 * route is built, never before — a navigation item that 404s teaches people
 * to distrust the navigation.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandLogo, BrandMark, Icon, type IconName } from "@/ui/icons";
import { Avatar, Badge, Kbd, cx, inputClass } from "@/ui/primitives";
import { buttonClass } from "@/ui/styles";
import { ThemeToggle } from "@/features/shell/components/theme-toggle";
import { Portal } from "@/ui/portal";
import { CommandPalette, openCommandPalette } from "@/features/shell/components/command-palette";
import { ActivityPanel, openActivityPanel } from "@/features/shell/components/activity-panel";
import { HelpModal, openHelp } from "@/features/shell/components/help-modal";
import { SupportWidget, openSupport } from "@/features/shell/components/support-widget";
import type { ClientOption } from "@/shared/contracts/client";
import type { Workspace } from "@/shared/contracts/workspace";
import { signOut } from "@/server/modules/auth/actions";

/* -------------------------------------------------------------------------- */
/* Navigation model                                                           */
/* -------------------------------------------------------------------------- */

interface Item {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly badge?: string;
  /** Exact match by default; `prefix` lights the item for every path below it. */
  readonly prefix?: boolean;
}

interface Group {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  readonly children: ReadonlyArray<{ href: string; label: string }>;
}

type ClientEntry = Item | Group;

const FIRM_ITEMS: readonly Item[] = [
  { href: "/accounts", icon: "table", label: "Chart of Accounts", prefix: true },
  { href: "/clients", icon: "list-checks", label: "All Clients" },
  { href: "/reconcile", icon: "sparkles", label: "Reconciliation", badge: "AI", prefix: true },
  { href: "/memory", icon: "wand", label: "Coding Memory", prefix: true },
];

/** The sections of one client's workspace, in the order a person works them. */
function clientEntries(base: string): readonly ClientEntry[] {
  return [
    {
      key: "info",
      icon: "info",
      label: "Client Info",
      children: [
        { href: `${base}/details?tab=basic`, label: "Basic Info" },
        { href: `${base}/details?tab=entity`, label: "Business Entity" },
        { href: `${base}/details?tab=opening`, label: "Opening Balance" },
      ],
    },
    { href: `${base}/transactions`, icon: "receipt", label: "Transactions", prefix: true },
    { href: `${base}/journals`, icon: "book-open", label: "Journals", prefix: true },
    { href: `${base}/accounts`, icon: "table", label: "Chart of Accounts", prefix: true },
    { href: `${base}/banks`, icon: "landmark", label: "Banks", prefix: true },
    { href: `${base}/assets`, icon: "trending-down", label: "Depreciation", prefix: true },
    { href: `${base}/loans`, icon: "banknote", label: "Loans", prefix: true },
    {
      key: "reports",
      icon: "bar-chart",
      label: "Reports",
      children: [
        { href: `${base}/reports/bas`, label: "Business Activity Statement" },
        { href: `${base}/reports/profit-and-loss`, label: "Profit & Loss" },
        { href: `${base}/reports/balance-sheet`, label: "Balance Sheet" },
        { href: `${base}/reports/trial-balance`, label: "Trial Balance" },
        { href: `${base}/reports/general-ledger`, label: "General Ledger Summary" },
        { href: `${base}/reports/transactions`, label: "Transaction Report" },
        { href: `${base}/reports/depreciation`, label: "Depreciation Schedule" },
        { href: `${base}/reports/tpar`, label: "Taxable Payments Annual Report" },
        { href: `${base}/reports/eofy`, label: "EOFY Statement" },
      ],
    },
    { href: `${base}/subcontractors`, icon: "hard-hat", label: "Subcontractors", prefix: true },
    { href: `${base}/memory`, icon: "wand", label: "Coding Memory", prefix: true },
  ];
}

const isGroup = (entry: ClientEntry): entry is Group => "children" in entry;

/** Path plus query, so tabbed pages can light the right sub-item. */
function hrefMatches(href: string, pathname: string, search: string): boolean {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (!query) return search === "" || !search.includes("tab=");
  return search.includes(query);
}

const COLLAPSE_KEY = "ledgerly-sidebar";

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: Item;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors",
        active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sunken",
        collapsed && "lg:justify-center lg:px-0",
      )}
    >
      <Icon name={item.icon} className={cx("size-[18px] shrink-0", active ? "text-accent" : "text-ink-2")} strokeWidth={1.9} />
      <span className={cx("flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
      {item.badge ? (
        <span className={cx("rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white", collapsed && "lg:hidden")}>
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavGroup({
  group,
  open,
  activeChild,
  collapsed,
  onToggle,
  onNavigate,
}: {
  group: Group;
  open: boolean;
  activeChild: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const active = activeChild !== null;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={collapsed ? group.label : undefined}
        className={cx(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors",
          active && !open ? "bg-accent-soft text-accent-ink" : active ? "text-accent-ink" : "text-ink hover:bg-sunken",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <Icon name={group.icon} className={cx("size-[18px] shrink-0", active ? "text-accent" : "text-ink-2")} strokeWidth={1.9} />
        <span className={cx("flex-1 truncate text-left", collapsed && "lg:hidden")}>{group.label}</span>
        <Icon name="chevron-down" className={cx("size-4 text-ink-3 transition-transform", open && "rotate-180", collapsed && "lg:hidden")} />
      </button>
      {open ? (
        <ul className={cx("ml-5 mt-0.5 flex flex-col gap-0.5 border-l-2 border-rule pl-2", collapsed && "lg:hidden")}>
          {group.children.map((child) => {
            const current = child.href === activeChild;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "block rounded-lg px-3 py-2 text-[13px] leading-snug transition-colors",
                    current ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
                  )}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A small card anchored below its trigger; the backdrop closes it. */
function Popover({
  open,
  onClose,
  label,
  anchor,
  width = "w-64",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  anchor: React.RefObject<HTMLElement | null>;
  width?: string | undefined;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 272) });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !position) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden="true" />
      <div role="menu" aria-label={label} style={{ top: position.top, left: position.left }} className={cx("card fixed z-[70] p-1.5 shadow-pop animate-pop-in", width)}>
        {children}
      </div>
    </Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function AppShell({
  workspace,
  children,
}: {
  readonly workspace: Workspace;
  readonly children: React.ReactNode;
}) {
  const { user, firmName, clients, quota, plan, attention } = workspace;
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.size > 0 ? `?${params.toString()}` : "";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const userMenuAnchor = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "collapsed");
    } catch {
      /* private mode */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !value;
    });
  }

  // "C" opens the Command Bar, unless the person is already typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "c") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      openCommandPalette();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeDrawer = () => setMobileOpen(false);

  const activeClient: ClientOption | undefined = clients.find((client) => pathname.startsWith(`/clients/${client.id}`));
  const entries = useMemo(() => (activeClient ? clientEntries(`/clients/${activeClient.id}`) : []), [activeClient]);

  // The group holding the current page starts open.
  useEffect(() => {
    for (const entry of entries) {
      if (isGroup(entry) && entry.children.some((child) => hrefMatches(child.href, pathname, search))) {
        setOpenGroups((state) => (state[entry.key] ? state : { ...state, [entry.key]: true }));
      }
    }
  }, [entries, pathname, search]);

  const filteredClients = useMemo(() => {
    const needle = clientQuery.trim().toLowerCase();
    return needle ? clients.filter((client) => client.businessName.toLowerCase().includes(needle)) : clients;
  }, [clients, clientQuery]);

  const remaining = Math.max(0, quota.total - quota.used);
  const usedPct = quota.total > 0 ? Math.min(100, Math.round((quota.used / quota.total) * 100)) : 0;

  const sidebar = (
    <>
      {/* Brand, plan, support, account */}
      <div className={cx("card flex items-center gap-2 p-2.5", collapsed && "lg:flex-col lg:gap-2")}>
        <Link href="/" onClick={closeDrawer} title="Home" className="shrink-0">
          <BrandMark className="size-10" />
        </Link>
        <span className={cx("flex-1", collapsed && "lg:hidden")} />
        {plan.code !== "SCALE" ? (
          <Link
            href="/settings/plan"
            onClick={closeDrawer}
            title="Plan & usage"
            className={cx(
              "inline-flex h-9 items-center gap-1.5 rounded-full border border-warning/40 bg-warning-soft px-3 text-[12px] font-bold text-warning-ink transition-colors hover:border-warning",
              collapsed && "lg:size-9 lg:px-0 lg:justify-center",
            )}
          >
            <Icon name="gem" className="size-3.5" />
            <span className={cx(collapsed && "lg:hidden")}>{plan.isTrial ? "Upgrade" : plan.name}</span>
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => {
            closeDrawer();
            openSupport();
          }}
          aria-label="Support"
          title="Support"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-rule text-ink transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Icon name="headset" className="size-4" />
        </button>
        <button
          ref={userMenuAnchor}
          type="button"
          onClick={() => setUserMenu((open) => !open)}
          aria-label="Account menu"
          aria-expanded={userMenu}
          className="shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-accent/30"
        >
          <Avatar name={user.name} size="lg" />
        </button>
        <Popover open={userMenu} onClose={() => setUserMenu(false)} label="Account" anchor={userMenuAnchor}>
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold">{user.name}</p>
              <p className="truncate text-xs text-ink-3">{firmName}</p>
            </div>
          </div>
          <div className="border-t border-rule py-1">
            <Link href="/settings" onClick={() => setUserMenu(false)} className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-ink hover:bg-surface-2">
              <Icon name="settings" className="size-4 text-ink-2" />
              Settings
            </Link>
            <Link href="/settings/plan" onClick={() => setUserMenu(false)} className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-ink hover:bg-surface-2">
              <Icon name="coins" className="size-4 text-ink-2" />
              Manage subscription
            </Link>
            <button
              type="button"
              onClick={() => {
                setUserMenu(false);
                openHelp();
              }}
              className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-2"
            >
              <Icon name="help-circle" className="size-4 text-ink-2" />
              Help
            </button>
          </div>
          <div className="border-t border-rule">
            <ThemeToggle />
          </div>
          <form action={signOut} className="border-t border-rule py-1">
            <button type="submit" className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-negative-ink hover:bg-negative-soft">
              <Icon name="log-out" className="size-4" />
              Sign out
            </button>
          </form>
        </Popover>
      </div>

      {/* Command Bar, modules, clients */}
      <div className="card flex min-h-0 flex-1 flex-col">
        <div className={cx("flex items-center gap-2 border-b border-rule px-3 py-2.5", collapsed && "lg:flex-col lg:px-2")}>
          <button
            type="button"
            onClick={() => {
              closeDrawer();
              openCommandPalette();
            }}
            title="Command Bar"
            className={cx("flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink", collapsed && "lg:flex-none")}
          >
            <span className={cx("flex items-center gap-1", collapsed && "lg:hidden")}>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
            <Icon name="sparkles" className="size-4 text-accent" />
            <span className={cx("truncate font-semibold text-ink", collapsed && "lg:hidden")}>Quick actions</span>
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink lg:inline-flex"
          >
            <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} className="size-4" />
          </button>
          <button type="button" onClick={closeDrawer} aria-label="Close menu" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken lg:hidden">
            <Icon name="x" />
          </button>
        </div>

        <nav aria-label="Main" className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          {FIRM_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={item.prefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href}
              collapsed={collapsed}
              onNavigate={closeDrawer}
            />
          ))}

          {activeClient ? (
            <>
              <Link
                href={`/clients/${activeClient.id}`}
                onClick={closeDrawer}
                title={activeClient.businessName}
                className={cx(
                  "mt-2 flex items-center gap-2.5 rounded-full border border-accent/40 bg-surface px-2 py-1.5 text-[13px] font-bold text-ink shadow-xs",
                  collapsed && "lg:justify-center lg:border-0 lg:px-0 lg:shadow-none",
                )}
              >
                <Avatar name={activeClient.businessName} size="sm" />
                <span className={cx("min-w-0 flex-1 truncate", collapsed && "lg:hidden")}>{activeClient.businessName}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    closeDrawer();
                    openCommandPalette();
                  }}
                  aria-label="Switch client"
                  className={cx("inline-flex size-6 items-center justify-center rounded-full text-ink-3 hover:text-accent", collapsed && "lg:hidden")}
                >
                  <Icon name="search" className="size-3.5" />
                </button>
              </Link>
              <div className="my-2 border-t border-rule" />
              {entries.map((entry) =>
                isGroup(entry) ? (
                  <NavGroup
                    key={entry.key}
                    group={entry}
                    open={openGroups[entry.key] === true}
                    activeChild={entry.children.find((child) => hrefMatches(child.href, pathname, search))?.href ?? null}
                    collapsed={collapsed}
                    onToggle={() => setOpenGroups((state) => ({ ...state, [entry.key]: !state[entry.key] }))}
                    onNavigate={closeDrawer}
                  />
                ) : (
                  <NavLink
                    key={entry.href}
                    item={entry}
                    active={pathname === entry.href || (entry.prefix === true && pathname.startsWith(`${entry.href}/`))}
                    collapsed={collapsed}
                    onNavigate={closeDrawer}
                  />
                ),
              )}
            </>
          ) : (
            <>
              <div className={cx("relative mt-2", collapsed && "lg:hidden")}>
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                <input
                  type="search"
                  value={clientQuery}
                  onChange={(event) => setClientQuery(event.target.value)}
                  placeholder="Search client"
                  aria-label="Search clients"
                  className={cx(inputClass, "h-10 rounded-full pl-9")}
                />
              </div>
              {clients.length === 0 ? (
                <p className={cx("px-3 py-4 text-center text-[13px] text-ink-3", collapsed && "lg:hidden")}>No clients yet.</p>
              ) : filteredClients.length === 0 ? (
                <p className={cx("px-3 py-4 text-center text-[13px] text-ink-3", collapsed && "lg:hidden")}>No client matches.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {filteredClients.map((client) => (
                    <li key={client.id}>
                      <Link
                        href={`/clients/${client.id}`}
                        onClick={closeDrawer}
                        title={client.businessName}
                        className={cx(
                          "flex items-center gap-2.5 rounded-full border border-rule bg-surface px-2 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft/40",
                          collapsed && "lg:justify-center lg:border-0 lg:px-0",
                        )}
                      >
                        <Avatar name={client.businessName} size="sm" />
                        <span className={cx("truncate", collapsed && "lg:hidden")}>{client.businessName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </nav>

        <div className={cx("flex shrink-0 flex-col gap-2 border-t border-rule p-3", collapsed && "lg:items-center lg:px-2")}>
          <div className={cx("flex items-center justify-between gap-3 rounded-2xl bg-accent-soft/70 px-3.5 py-3", collapsed && "lg:hidden")}>
            <div className="min-w-0">
              <p className="text-[12px] text-ink-2">Transactions remaining</p>
              <p className="figure mt-0.5 flex items-center gap-1.5 text-[17px] font-bold text-accent-ink">
                <Icon name="coins" className="size-4" />
                {remaining.toLocaleString("en-AU")}
              </p>
              <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-surface">
                <div className={cx("h-full rounded-full", usedPct >= 90 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.max(usedPct, 2)}%` }} />
              </div>
            </div>
            <Link href="/settings/plan" onClick={closeDrawer} className={buttonClass({ variant: "secondary", size: "sm", className: "rounded-full" })}>
              Manage
            </Link>
          </div>
          <Link
            href="/clients?new=1"
            onClick={closeDrawer}
            title="Add new client"
            className={cx(buttonClass({ variant: "secondary", className: "w-full rounded-full" }), collapsed && "lg:size-10 lg:w-10 lg:px-0")}
          >
            <Icon name="user-plus" />
            <span className={cx(collapsed && "lg:hidden")}>Add New Client</span>
          </Link>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-svh gap-3 bg-ground p-3">
      {mobileOpen ? <div aria-hidden="true" onClick={closeDrawer} className="fixed inset-0 z-40 bg-sidebar/40 backdrop-blur-sm animate-fade-in lg:hidden" /> : null}

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[19.5rem] shrink-0 flex-col gap-3 p-3 transition-[transform,width] duration-200 ease-out lg:sticky lg:top-3 lg:h-[calc(100svh-1.5rem)] lg:translate-x-0 lg:p-0",
          collapsed && "lg:w-[4.75rem]",
          mobileOpen ? "translate-x-0 bg-ground" : "-translate-x-full",
        )}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Small screens: a slim bar with the menu button. */}
        <div className="card mb-3 flex items-center gap-3 px-3 py-2 lg:hidden" data-print-hide>
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="inline-flex size-9 items-center justify-center rounded-lg text-ink hover:bg-sunken">
            <Icon name="menu" />
          </button>
          <BrandLogo className="h-7" />
          <button type="button" onClick={() => openCommandPalette()} aria-label="Command Bar" className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken">
            <Icon name="search" className="size-5" />
          </button>
        </div>

        <main id="main" className="min-h-0 flex-1 pb-20 lg:px-1 lg:pt-1">
          <div className="mx-auto w-full max-w-[96rem] animate-rise-in">{children}</div>
        </main>
      </div>

      {/* The orb: the Activity Panel, from anywhere on the page. */}
      <button
        type="button"
        data-print-hide
        onClick={openActivityPanel}
        aria-label={attention > 0 ? `Activity — ${attention} transactions awaiting review` : "Activity"}
        title="Activity"
        className="fixed bottom-6 right-6 z-40 inline-flex size-14 items-center justify-center rounded-full bg-surface shadow-pop ring-1 ring-rule transition-transform hover:scale-105 active:scale-95"
      >
        <span aria-hidden="true" className="relative size-9 rounded-full bg-[conic-gradient(from_180deg,#2563eb,#38bdf8,#6366f1,#2563eb)] shadow-glow animate-orb-spin" />
        {attention > 0 ? <Badge tone="negative" className="absolute -right-1 -top-1">{attention > 99 ? "99+" : attention}</Badge> : null}
      </button>

      <ActivityPanel />
      <HelpModal />
      <SupportWidget />
      <CommandPalette clients={clients} activeClient={activeClient} />
    </div>
  );
}

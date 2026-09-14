"use client";

/**
 * The sections of one client's workspace.
 *
 * Tabs live here rather than in the sidebar because the sidebar lists modules,
 * not the inside of a record — and because the active section is a property of
 * the URL, which only a client component can read.
 *
 * Grouped by what a person is doing: the daily work first, the ledger and its
 * reports next, the registers behind the specialist reports, then setup.
 * Like the sidebar's MODULES, this lists only sections that exist.
 */

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Icon, type IconName } from "@/ui/icons";
import { cx } from "@/ui/primitives";

interface Tab {
  /** The route segment below /clients/[id]; null is the workspace root. */
  readonly segment: string | null;
  readonly label: string;
  readonly icon: IconName;
}

const GROUPS: ReadonlyArray<readonly Tab[]> = [
  [
    { segment: null, label: "Overview", icon: "dashboard" },
    { segment: "transactions", label: "Transactions", icon: "receipt" },
    { segment: "journals", label: "Journals", icon: "book-open" },
    { segment: "reports", label: "Reports", icon: "bar-chart" },
  ],
  [
    { segment: "banks", label: "Banks", icon: "landmark" },
    { segment: "accounts", label: "Chart", icon: "table" },
    { segment: "memory", label: "Memory", icon: "sparkles" },
  ],
  [
    { segment: "assets", label: "Assets", icon: "briefcase" },
    { segment: "loans", label: "Loans", icon: "banknote" },
    { segment: "subcontractors", label: "Subcontractors", icon: "hard-hat" },
    { segment: "details", label: "Details", icon: "building" },
  ],
];

export function ClientTabs({ clientId }: { clientId: string }) {
  const active = useSelectedLayoutSegment();

  return (
    <div
      role="navigation"
      aria-label="Client sections"
      className="scrollbar-none flex items-center gap-1 overflow-x-auto rounded-2xl border border-rule bg-surface p-1.5 shadow-card"
    >
      {GROUPS.map((group, index) => (
        <div key={index} className="flex shrink-0 items-center gap-1">
          {index > 0 ? <span aria-hidden="true" className="mx-1 h-5 w-px bg-rule" /> : null}
          {group.map((tab) => {
            const current = active === tab.segment;
            return (
              <Link
                key={tab.label}
                href={`/clients/${clientId}${tab.segment ? `/${tab.segment}` : ""}`}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition-all duration-200",
                  current
                    ? "bg-accent-gradient text-white shadow-glow"
                    : "text-ink-2 hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon name={tab.icon} className={cx("size-4 shrink-0", current ? "text-white" : "text-ink-3")} strokeWidth={1.9} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

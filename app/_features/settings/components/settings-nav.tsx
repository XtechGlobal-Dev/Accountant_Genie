"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/ui/icons";
import { buttonClass, cx } from "@/ui/styles";

/** The sections of Settings. Lists only routes that exist. */
const SECTIONS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/settings", label: "Profile Settings", icon: "user-plus" },
  { href: "/settings/plan", label: "Manage Subscription", icon: "credit-card" },
  { href: "/settings/team", label: "Team", icon: "users" },
  { href: "/settings/tax-rules", label: "Tax Rules", icon: "file-text" },
  { href: "/settings/audit", label: "Audit Trail", icon: "shield-check" },
];

/**
 * A card of sections: a heading, the list with the open section marked by a
 * bar on its left edge, and at the foot a nudge towards the plans and the
 * way back.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const onPlan = pathname === "/settings/plan";

  return (
    <nav aria-label="Settings" className="card flex flex-col p-3 lg:w-72 lg:shrink-0">
      <div className="px-2 pb-3 pt-1">
        <h1 className="display text-[1.125rem]">Account Settings</h1>
        <p className="mt-1 text-[13px] text-ink-2">Manage your account and preferences</p>
      </div>

      <ul className="flex flex-col gap-1">
        {SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors",
                  active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sunken",
                )}
              >
                {active ? <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent" /> : null}
                <Icon name={section.icon} className={cx("size-[18px] shrink-0", active ? "text-accent" : "text-ink-2")} />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {onPlan ? null : (
        <div className="mt-auto rounded-2xl bg-accent-soft/60 p-3.5 pt-3.5 max-lg:mt-3">
          <p className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <Icon name="crown" className="size-[18px] text-warning" />
            Upgrade to Pro
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">More transactions, more team seats and priority support.</p>
          <Link
            href="/settings/plan"
            className={cx(buttonClass({ variant: "secondary", size: "sm" }), "mt-2.5 border-accent/40 text-accent-ink")}
          >
            View Plans
            <Icon name="arrow-right" />
          </Link>
        </div>
      )}

      <Link href="/" className={buttonClass({ variant: "secondary", className: "mt-3 w-full" })}>
        <Icon name="arrow-left" />
        Back to Accountant Genie
      </Link>
    </nav>
  );
}

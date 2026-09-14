import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { getSettings, listAudit } from "@/server/modules/firms/service";
import { listTeam } from "@/server/modules/auth/service";
import { abn as formatAbn, shortDate } from "@/shared/format";
import { ChangePasswordCard } from "@/features/settings/components/change-password-card";
import { EditFirmButton, EditProfileButton } from "@/features/settings/components/settings-forms";
import { Icon, type IconName } from "@/ui/icons";
import { buttonClass, cx } from "@/ui/styles";
import { Avatar, Badge, Card, CardHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Profile settings" };

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  BOOKKEEPER: "Bookkeeper",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

const DAY_MS = 86_400_000;
const TEAM_PREVIEW = 5;
const ACTIVITY_PREVIEW = 6;

const when = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" });

/** One fact in the hero: a quiet icon, the label, and the value in bold. */
function Fact({ icon, label, value }: { icon: IconName; label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px]">
      <Icon name={icon} className="size-4 text-ink-3" strokeWidth={1.8} />
      <span className="text-ink-2">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

const TILE_TONES = {
  accent: "bg-accent-soft/70 text-accent",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
} as const;

/** A tinted tile with one count: the profile's place in the firm at a glance. */
function Tile({ icon, label, value, tone }: { icon: IconName; label: string; value: number; tone: keyof typeof TILE_TONES }) {
  return (
    <div className={cx("flex min-w-[9.5rem] items-center gap-2.5 rounded-xl p-3", TILE_TONES[tone])}>
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface shadow-xs">
        <Icon name={icon} className="size-[18px]" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium leading-tight text-ink-2">{label}</p>
        <p className="figure text-[1.125rem] font-bold leading-tight text-ink">{value.toLocaleString("en-AU")}</p>
      </div>
    </div>
  );
}

/** One row of the firm's details: label on the left, value on the right. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 py-3 text-sm">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** A quiet link in a card header that leads to the full section. */
function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonClass({ variant: "secondary", size: "sm" })}>
      {children}
      <Icon name="arrow-right" />
    </Link>
  );
}

/**
 * Profile settings: who you are across the top, then the password and the
 * firm, then the people and the latest changes — each with the way to its
 * full section. Editing happens in a dialog so the facts on the page are
 * always what is saved.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const canAudit = can(session, "audit:read");
  const [settings, team, activity] = await Promise.all([
    getSettings(session.firmId, session.userId),
    listTeam(session.firmId),
    canAudit ? listAudit(session.firmId, ACTIVITY_PREVIEW) : Promise.resolve([]),
  ]);
  if (!settings) notFound();

  const { user, firm } = settings;
  const daysActive = Math.max(1, Math.floor((Date.now() - user.memberSince.getTime()) / DAY_MS) + 1);
  const members = team.slice(0, TEAM_PREVIEW);

  return (
    <div className="flex flex-col gap-3">
      {/* Who you are */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-5">
          <Avatar name={user.name} size="xl" className="size-20 text-2xl shadow-card ring-[6px] ring-accent-soft/60" />
          <div className="min-w-0 flex-1 basis-[20rem]">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="display text-[1.5rem]">{user.name}</h1>
              <Badge tone="accent" className="px-3 py-1 text-xs">
                {ROLE_LABELS[user.role] ?? user.role}
              </Badge>
              {user.isTaxAgent ? <Badge tone="positive">Registered tax agent</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-ink-2">{user.email}</p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <Fact icon="building" label="Firm" value={firm.name} />
              <Fact icon="calendar" label="Member since" value={shortDate(user.memberSince)} />
              {user.isTaxAgent ? <Fact icon="shield-check" label="Agent number" value={<span className="figure">{user.agentNumber ?? "—"}</span>} /> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Tile icon="users" label="Clients" value={firm.clientCount} tone="accent" />
            <Tile icon="users" label="Team members" value={firm.userCount} tone="positive" />
            <Tile icon="clock" label="Days active" value={daysActive} tone="warning" />
          </div>
          <EditProfileButton user={user} />
        </div>
      </Card>

      {/* Security and the firm */}
      <div className="grid gap-3 xl:grid-cols-2">
        <ChangePasswordCard required={session.mustChangePassword || query.password === "1"} />
        <Card className="flex flex-col">
          <CardHeader icon="building" title="Firm Details" description="The practice these books belong to." action={<EditFirmButton firm={firm} />} />
          <dl className="flex flex-1 flex-col justify-center divide-y divide-rule-soft px-6 py-1">
            <Row label="Name" value={firm.name} />
            <Row label="ABN" value={<span className="figure">{formatAbn(firm.abn)}</span>} />
            <Row label="Clients" value={<span className="figure">{firm.clientCount}</span>} />
            <Row label="Team members" value={<span className="figure">{firm.userCount}</span>} />
            <Row label="Firm since" value={shortDate(firm.createdAt)} />
          </dl>
        </Card>
      </div>

      {/* The people and the latest changes */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader
            icon="users"
            title="Team"
            description="Everyone who can open this firm's books."
            action={<SectionLink href="/settings/team">Manage team</SectionLink>}
          />
          <ul className="flex flex-1 flex-col divide-y divide-rule-soft px-6 py-1">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="truncate">{member.name}</span>
                    {member.id === session.userId ? <Badge tone="accent">You</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-ink-3">{member.email}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone="outline">{ROLE_LABELS[member.role] ?? member.role}</Badge>
                  <span className="text-[11px] text-ink-3">
                    {member.lastLoginAt ? `Signed in ${shortDate(member.lastLoginAt)}` : "Never signed in"}
                  </span>
                </div>
              </li>
            ))}
            {team.length > TEAM_PREVIEW ? (
              <li className="py-2.5 text-center text-xs text-ink-3">{team.length - TEAM_PREVIEW} more in Team</li>
            ) : null}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            icon="clipboard-list"
            title="Recent activity"
            description="The latest changes, as the audit trail recorded them."
            action={canAudit ? <SectionLink href="/settings/audit">Audit trail</SectionLink> : undefined}
          />
          {!canAudit ? (
            <p className="px-6 py-8 text-center text-sm text-ink-2">Your role cannot read the audit trail. Ask an owner or admin.</p>
          ) : activity.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-ink-2">Nothing recorded yet.</p>
          ) : (
            <ul className="flex flex-1 flex-col divide-y divide-rule-soft px-6 py-1">
              {activity.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  <Badge tone="outline" className="shrink-0">
                    {row.action.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                  <p className="min-w-0 flex-1 truncate text-sm text-ink">
                    <span className="text-ink-2">{row.entityType}</span>
                    {row.clientName ? <span className="text-ink-2"> · {row.clientName}</span> : null}
                    <span className="text-ink-2"> · {row.userName ?? "System"}</span>
                  </p>
                  <span className="figure shrink-0 text-xs text-ink-3">{when.format(row.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

"use client";

/**
 * The firm's people and their roles. Roles map to permissions in one place
 * on the server; this screen only names them.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRole, inviteUser, setTaxAgentStatus } from "@/server/modules/auth/actions";
import type { MailOutcome } from "@/shared/contracts/result";
import type { TeamMember } from "@/shared/contracts/settings";
import type { UserRole } from "@/shared/enums";
import { shortDate } from "@/shared/format";
import { Alert, Avatar, Badge, Button, Field, Modal, ModalFooter, PageHeader, Select, cx, inputClass, submitWith } from "@/ui/primitives";

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  BOOKKEEPER: "Bookkeeper",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

const ROLE_HINTS: Record<UserRole, string> = {
  OWNER: "Everything, including billing and the team.",
  ADMIN: "Everything, including billing and the team.",
  ACCOUNTANT: "All accounting work; not billing or the team.",
  BOOKKEEPER: "Code, accept and post; read reports.",
  STAFF: "Upload statements and code transactions; no acceptance.",
  VIEWER: "Read only.",
};

export function TeamView({ members, meId, canManage }: { members: TeamMember[]; meId: string; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [invite, setInvite] = useState(false);
  const [agentFor, setAgentFor] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withdrawTaxAgent(member: TeamMember) {
    setBusy(member.id);
    setError(null);
    const form = new FormData();
    form.set("isTaxAgent", "no");
    const result = await setTaxAgentStatus(member.id, form);
    if (!result.ok) setError(result.error);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  async function setRole(member: TeamMember, role: string) {
    setBusy(member.id);
    setError(null);
    const form = new FormData();
    form.set("role", role);
    const result = await changeRole(member.id, form);
    if (!result.ok) setError(result.error);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Team"
        context="Who works in this firm and what they may do."
        action={
          canManage ? (
            <Button icon="user-plus" onClick={() => setInvite(true)}>
              Add team member
            </Button>
          ) : undefined
        }
      />
      {error ? <Alert tone="negative">{error}</Alert> : null}

      <div className="sheet overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th className="w-48">Role</th>
              <th className="w-32">Last sign-in</th>
              <th className="w-32">Added</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.name} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {member.name}
                        {member.id === meId ? <span className="ml-2 text-xs font-normal text-ink-3">you</span> : null}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{member.email}</span>
                    </span>
                    {member.isTaxAgent ? <Badge tone="accent">Tax agent</Badge> : null}
                    {member.mustChangePassword ? <Badge tone="warning">Temporary password</Badge> : null}
                    {canManage ? (
                      member.isTaxAgent ? (
                        <Button variant="ghost" size="sm" disabled={busy === member.id} onClick={() => withdrawTaxAgent(member)}>
                          Withdraw registration
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={busy === member.id} onClick={() => setAgentFor(member)}>
                          Record tax agent registration
                        </Button>
                      )
                    ) : null}
                  </span>
                </td>
                <td>
                  {canManage && member.id !== meId ? (
                    <select
                      value={member.role}
                      disabled={busy === member.id}
                      onChange={(event) => setRole(member, event.target.value)}
                      aria-label={`Role for ${member.name}`}
                      className={cx(inputClass, "h-9 py-1")}
                    >
                      {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={member.role === "OWNER" ? "accent" : "neutral"}>{ROLE_LABELS[member.role]}</Badge>
                  )}
                </td>
                <td className="text-ink-2">{member.lastLoginAt ? shortDate(member.lastLoginAt) : "Never"}</td>
                <td className="text-ink-2">{shortDate(member.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card px-5 py-4">
        <p className="text-sm font-semibold">What each role may do</p>
        <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
            <div key={role} className="flex gap-3">
              <dt className="w-24 shrink-0 font-medium">{ROLE_LABELS[role]}</dt>
              <dd className="text-ink-2">{ROLE_HINTS[role]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {invite ? <InviteModal onClose={() => setInvite(false)} /> : null}
      {agentFor ? <TaxAgentModal member={agentFor} onClose={() => setAgentFor(null)} /> : null}
    </div>
  );
}

const PROFESSIONAL_BODY_OPTIONS = [
  ["CA_ANZ", "Chartered Accountants ANZ"],
  ["CPA_AUSTRALIA", "CPA Australia"],
  ["IPA", "Institute of Public Accountants"],
  ["ATMA", "Association of Taxation and Management Accountants"],
  ["TPB", "Tax Practitioners Board (direct)"],
  ["NTAA", "National Tax & Accountants' Association"],
  ["OTHER", "Other"],
] as const;

/**
 * Recording a colleague's registration is what confers the right to verify
 * tax rules and treatments for this firm. The body and number are required
 * so the grant is evidenced, and the change is audited either way.
 */
function TaxAgentModal({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("isTaxAgent", "yes");
    startTransition(async () => {
      const result = await setTaxAgentStatus(member.id, formData);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }
  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record registration for ${member.name}`}
      description="A registered tax agent may verify this firm's tax rules and account treatments. Enter the body and number their registration is held with."
    >
      <form onSubmit={submitWith(submit)}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}
          <Select label="Registered with" name="professionalBody" defaultValue="" required error={errorFor("professionalBody")}>
            <option value="">Select a body</option>
            {PROFESSIONAL_BODY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Field label="Registration number" name="agentNumber" required inputMode="numeric" error={errorFor("agentNumber")} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record registration"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [added, setAdded] = useState<{ temporaryPassword: string | null; mail: MailOutcome } | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    startTransition(async () => {
      const result = await inviteUser(formData);
      if (result.ok) {
        setAdded({ temporaryPassword: result.temporaryPassword, mail: result.mail });
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }
  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);

  return (
    <Modal open onClose={onClose} title="Add team member" description="They receive a temporary password and must change it on first sign-in.">
      {added ? (
        <>
          <div className="flex flex-col gap-3 px-5 py-5">
            <Alert
              tone={added.mail === "sent" ? "positive" : "warning"}
              title={added.mail === "sent" ? "Team member added" : "Team member added, but not emailed"}
            >
              They must change their password the first time they sign in.
            </Alert>
            {added.temporaryPassword ? (
              <div className="rounded-2xl border border-rule bg-surface-2 p-4">
                <p className="text-xs text-ink-3">
                  {added.mail === "logged"
                    ? "No email provider is configured, so hand this temporary password over yourself."
                    : "The email was refused, so they have not received it. Hand this temporary password over yourself, or fix the mail settings and add them again."}{" "}
                  It is shown once and not stored.
                </p>
                <p className="code mt-2 select-all text-base">{added.temporaryPassword}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-2">Their temporary password has been emailed to them.</p>
            )}
          </div>
          <ModalFooter>
            <Button onClick={onClose}>Done</Button>
          </ModalFooter>
        </>
      ) : (
        <form onSubmit={submitWith(submit)}>
          <div className="flex flex-col gap-4 px-5 py-5">
            {error && !field ? <Alert tone="negative">{error}</Alert> : null}
            <Field label="Name" name="name" required error={errorFor("name")} />
            <Field label="Email" name="email" type="email" required error={errorFor("email")} />
            <Select label="Role" name="role" defaultValue="ACCOUNTANT" error={errorFor("role")}>
              {(["ADMIN", "ACCOUNTANT", "BOOKKEEPER", "STAFF", "VIEWER"] as const).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]} — {ROLE_HINTS[role]}
                </option>
              ))}
            </Select>
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}

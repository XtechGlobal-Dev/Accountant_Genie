import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { listTeam } from "@/server/modules/auth/service";
import { TeamView } from "@/features/settings/components/team-view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireSession();
  const members = await listTeam(session.firmId);
  return <TeamView members={members} meId={session.userId} canManage={can(session, "users:manage")} />;
}

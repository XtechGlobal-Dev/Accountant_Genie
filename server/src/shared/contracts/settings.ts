/** The settings area: who is signed in, the firm they belong to, and the team. */

import type { UserRole } from "@/shared/enums";

export interface SettingsView {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isTaxAgent: boolean;
    agentNumber: string | null;
    memberSince: Date;
  };
  firm: {
    id: string;
    name: string;
    abn: string | null;
    createdAt: Date;
    userCount: number;
    clientCount: number;
  };
}

/** The plan meter, as the plan page shows it. */
export interface PlanView {
  planName: string;
  /** Reconciled transactions the allowance covers. */
  allowance: number;
  used: number;
  remaining: number;
  /** Where the allowance stands with clients, for context. */
  clientCount: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isTaxAgent: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  mustChangePassword: boolean;
}

/** One line of the audit trail, as the settings page lists it. */
export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  clientName: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

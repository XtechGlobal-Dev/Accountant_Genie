/** The firm's home screen: where the work stands across every client. */

import type { StatementImportRow } from "./client";

/** One client's share of the firm's transaction work. */
export interface ClientQueueRow {
  clientId: string;
  name: string;
  notCoded: number;
  awaitingReview: number;
  reviewed: number;
}

/** Transactions by month of the financial year, Jul → Jun. */
export interface MonthlyActivity {
  /** "Jul", "Aug", … */
  label: string;
  imported: number;
  coded: number;
  reviewed: number;
}

export interface DashboardView {
  clients: { active: number; archived: number };
  transactions: { total: number; awaitingReview: number; notCoded: number };
  journalCount: number;
  /** Most recent imports across the firm, newest first. */
  recentImports: (StatementImportRow & { clientId: string; clientName: string })[];
  queue: ClientQueueRow[];
  monthly: MonthlyActivity[];
}

/** Chart-of-accounts read models. */

import type { AccountType, GstTreatment } from "@/shared/enums";

/** Who an account belongs to: the platform, the firm, or one of its clients. */
export type AccountScope = "SYSTEM" | "FIRM" | "CLIENT";

export interface ChartAccountRow {
  id: string;
  /** The account number, e.g. 200. Integer, not a string. */
  code: number;
  name: string;
  description: string | null;
  type: AccountType;
  gstTreatment: GstTreatment;
  isSystem: boolean;
  isActive: boolean;
  scope: AccountScope;
  /** Set when the scope is CLIENT. */
  clientId: string | null;
  clientName: string | null;
  /** Journal lines posted against it. Non-zero locks the account's code. */
  postingCount: number;
  /** Tax treatment not yet signed off by THIS firm's registered tax advisor. */
  requiresVerification: boolean;
  taxNote: string | null;
  /** Who signed it off for this firm, when someone has. */
  verifiedBy: string | null;
  verifiedAt: Date | null;
  /** Optimistic lock; sent back with an edit so a stale form is refused. */
  version: number;
}

/** Accounts grouped for display, in report order. */
export interface ChartOfAccounts {
  groups: { type: AccountType; rows: ChartAccountRow[] }[];
  total: number;
  customCount: number;
  /** Every account still awaiting advisor verification, across all groups. */
  flagged: ChartAccountRow[];
}

/** An account as a picker offers it — for journal lines and recoding. */
export interface AccountOption {
  id: string;
  code: number;
  name: string;
  type: AccountType;
  gstTreatment: GstTreatment;
  /**
   * Whether a line posted here carries GST for this client: the account's
   * treatment bears GST and the client is registered. Decided on the server;
   * the form only uses it to preview the split.
   */
  gstBearing: boolean;
}

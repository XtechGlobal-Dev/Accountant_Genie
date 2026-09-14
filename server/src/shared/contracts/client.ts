/**
 * What the backend hands the frontend about a client.
 *
 * These are read models, not database rows. A page asks for exactly the shape
 * it renders, which keeps `select` lists honest and stops a column added for
 * one screen leaking into every other one.
 *
 * Money stays in integer cents across this boundary and becomes a string only
 * in `@/shared/format`.
 */

import type {
  BasFrequency,
  EntityType,
  GstBasis,
  ImportStatus,
} from "@/shared/enums";

/** One row of the client list. */
export interface ClientRow {
  id: string;
  businessName: string;
  abn: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  entityType: EntityType;
  gstRegistered: boolean;
  basFrequency: BasFrequency;
  bankCount: number;
  archived: boolean;
}

/** The identity strip above every section of a client's workspace. */
export interface ClientHeader {
  id: string;
  businessName: string;
  legalName: string | null;
  abn: string | null;
  entityType: EntityType;
  gstRegistered: boolean;
  gstBasis: GstBasis;
  basFrequency: BasFrequency;
  archived: boolean;
}

/** Everything on the details page, and everything the edit form writes back. */
export interface ClientDetail {
  id: string;
  businessName: string;
  legalName: string | null;
  abn: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  entityType: EntityType;
  gstRegistered: boolean;
  gstBasis: GstBasis;
  basFrequency: BasFrequency;
  /** Company only. */
  incomeTaxRate: number | null;
  /** Unit trust only. */
  totalUnits: number | null;
  /** Unit trust only. Integer cents. */
  unitValueCents: number | null;
  createdAt: Date;
}

export interface ClientNote {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
}

export interface StatementImportRow {
  id: string;
  filename: string;
  bankAccountName: string;
  status: ImportStatus;
  rowCount: number;
  duplicateCount: number;
  createdAt: Date;
}

/** A partner in a partnership. Share in basis points: 10 000 = 100%. */
export interface Partner {
  id: string;
  name: string;
  shareBasisPoints: number;
}

/** Where the work stands on one client, right now. */
export interface ClientOverview {
  bankAccounts: import("./bank-account").BankAccountSummary[];
  counts: {
    transactions: number;
    awaitingReview: number;
    notCoded: number;
  };
  journalCount: number;
  imports: StatementImportRow[];
  notes: ClientNote[];
}

/** Just enough to name a client in the sidebar and the Command Bar. */
export interface ClientOption {
  id: string;
  businessName: string;
}

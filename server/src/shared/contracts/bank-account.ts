/**
 * Bank accounts as the frontend sees them.
 *
 * Two rules hold across this whole file.
 *
 * **No full account numbers.** `accountMask` is the last three or four digits
 * and nothing more. See §6 "Data" in CLAUDE.md.
 *
 * **No provider credentials or opaque ids that act like one.** A Fiskil
 * consent id, arrangement id or end-user id is not secret, but it is also of
 * no use to a screen, so it does not cross this boundary. The one exception is
 * the auth session id, which the Link SDK genuinely needs in the browser and
 * which authorises nothing on its own — and it is returned from the action
 * that creates it, never stored in a page's props.
 *
 * Money is integer cents on both sides of this boundary.
 */

import type { BankAccountKind, BankSource, FeedConnectionStatus, FeedRequestStatus } from "@/shared/enums";

/** A line in the client overview's bank list. */
export interface BankAccountSummary {
  id: string;
  name: string;
  kind: BankAccountKind;
  accountMask: string | null;
  isCashAtBank: boolean;
  transactionCount: number;
}

/** The manage-accounts screen, which also shows provenance. */
export interface BankAccountRow extends BankAccountSummary {
  source: BankSource;
  importCount: number;
  createdAt: Date;
  /** Set for a fed account, so the screen can say where the data comes from. */
  feedLastSyncedAt?: Date | null;
  /**
   * The CDR product category the provider reported. Shown instead of the
   * coarse kind, so a mortgage is not presented as a bank account.
   */
  feedProductCategory?: string | null;
}

/**
 * Live balances, keyed by OUR bank account id — never the provider's.
 *
 * A separate shape from `BankAccountRow` on purpose: the stored row genuinely
 * has no balance, because Fiskil requires balances to be read fresh and we do
 * not persist them. Keeping them apart means a screen can never render a
 * balance it believes was stored.
 *
 * A value of `null` means the provider had nothing for that account this time;
 * a missing key means the account is not on a feed at all.
 */
export type LiveBalances = Record<string, number | null>;

/** A request to the client to authorise a live feed. The token never crosses this boundary. */
export interface FeedRequestRow {
  id: string;
  email: string;
  status: FeedRequestStatus;
  sentAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

/** A CDR consent at the provider. */
export interface FeedConnectionRow {
  id: string;
  provider: string;
  status: FeedConnectionStatus;
  institutionName: string | null;
  consentedAt: Date | null;
  /** When the client must re-authorise. CDR consents are time limited. */
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  /** Bank accounts this consent brought in. */
  accountCount: number;
  /** Expiring soon enough that the firm should ask the client to renew. */
  needsRenewal: boolean;
  /** False for a consent that never completed, which has nothing to revoke. */
  canRevoke: boolean;
}

/** One attempt to pull data from a consent — the provenance trail for a feed. */
export interface FeedSyncRunRow {
  id: string;
  /** WEBHOOK | MANUAL | BACKFILL */
  trigger: string;
  event: string | null;
  /** RUNNING | OK | ERROR */
  status: string;
  pagesFetched: number;
  rowsInserted: number;
  rowsUpdated: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** An entry in the bank picker shown before a consent starts. */
export interface FeedInstitutionOption {
  id: string;
  name: string;
  logo: string | null;
}

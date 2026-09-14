/**
 * The shapes we rely on from the Fiskil Data API, pinned to v3.
 *
 * Deliberately loose. Fiskil ships new optional fields and new enum values
 * *inside* a live major version, and their own guidance is to parse
 * defensively — unknown fields are safe to ignore, unknown enum values are
 * valid. So every list type keeps an index signature, and the untouched
 * payload is persisted next to the parsed columns (`BankTransaction.feedRaw`).
 *
 * Types only — no `server-only` marker, because the webhook event names are
 * also useful to the UI.
 */

export interface PaginationLinks {
  next?: string;
  prev?: string;
}

export interface FiskilEndUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  abn?: string;
  [key: string]: unknown;
}

/**
 * `POST /v1/end-users` returns ONLY the new id, under `end_user_id` — not the
 * `id` key that `GET /v1/end-users/{id}` uses for the same value. Mixing the
 * two up stores null silently, so they are typed apart.
 */
export interface CreateEndUserResponse {
  end_user_id?: string;
  id?: string;
  [key: string]: unknown;
}

/** v3 wraps this as `{ end_users, links }` — note the snake_case key. */
export interface ListEndUsersResponse {
  end_users?: FiskilEndUser[];
  links?: PaginationLinks;
}

export interface FiskilConsent {
  consent_id?: string;
  arrangement_id?: string;
  end_user_id?: string;
  institution_id?: string;
  institution_name?: string;
  active?: boolean;
  status?: string;
  created_at?: string;
  expires_at?: string;
  revoked_at?: string;
  [key: string]: unknown;
}

/** v3 wraps this as `{ consents, links }` — NOT snake_case, unlike end_users. */
export interface ListConsentsResponse {
  consents?: FiskilConsent[];
  links?: PaginationLinks;
}

export interface FiskilAuthSession {
  auth_url: string;
  session_id: string;
  /** Unix seconds. Auth sessions live five days. */
  expires_at: number;
  id?: string;
}

export interface FiskilInstitution {
  id: string;
  name?: string;
  logo?: string;
  [key: string]: unknown;
}

export interface FiskilAccount {
  account_id?: string;
  id?: string;
  display_name?: string;
  nickname?: string;
  masked_number?: string;
  product_category?: string;
  account_ownership?: string;
  open_status?: string;
  [key: string]: unknown;
}

export interface ListAccountsResponse {
  accounts?: FiskilAccount[];
  links?: PaginationLinks;
}

export interface FiskilBalance {
  account_id?: string;
  current_balance?: string;
  available_balance?: string;
  currency?: string;
  [key: string]: unknown;
}

export interface ListBalancesResponse {
  balances?: FiskilBalance[];
  links?: PaginationLinks;
}

/**
 * CONFIRMED 2026-09-11 against 781 live sandbox transactions. Fiskil does not
 * publish this schema, so these names are observed rather than documented —
 * keep the index signature and keep persisting `feedRaw`.
 *
 * Two traps are visible in the shape itself:
 *
 *  - `fiskil_id` and `transaction_id` are DIFFERENT values. `fiskil_id`
 *    (`bank_tx_…`) is Fiskil's stable id and is what the category override
 *    endpoint calls `fiskil_transaction_id`; `transaction_id` is the
 *    institution's own opaque id.
 *  - The settlement field is `posting_date_time`, not `posted_date_time`, and
 *    a PENDING transaction has NEITHER date field.
 */
export interface FiskilTransaction {
  /** Fiskil's stable identifier, `bank_tx_<hash>`. Our `externalId`. */
  fiskil_id?: string;
  /** The INSTITUTION's id for the same transaction. Not interchangeable. */
  transaction_id?: string;
  id?: string;
  account_id?: string;
  institution_id?: string;
  /** The CDR arrangement this transaction arrived under. */
  arrangement_id?: string;
  /** A decimal STRING, e.g. "-50.00". Converted to cents in `normalise.ts`. */
  amount?: string | number;
  currency?: string;
  description?: string;
  reference?: string;
  /** POSTED | PENDING. A PENDING row carries no date and is not ledgerable. */
  status?: string;
  /** Settlement time. Note the spelling. Absent while PENDING. */
  posting_date_time?: string;
  execution_date_time?: string;
  /** Seen on a small minority of rows; treated as an execution-time fallback. */
  value_date_time?: string;
  /** Categories are NESTED here, not flat on the transaction. */
  category?: {
    primary_category?: string;
    secondary_category?: string;
    /** VERY_HIGH | HIGH | MEDIUM | LOW */
    confidence_level?: string;
    [key: string]: unknown;
  };
  /** ISO 18245 merchant category code, e.g. "5812" for eating places. */
  merchant_category_code?: string;
  /** PAYMENT, etc. */
  type?: string;
  is_detail_available?: boolean;
  extended_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ListTransactionsResponse {
  transactions?: FiskilTransaction[];
  links?: PaginationLinks;
}

export interface IdentityResponse {
  /** v2 removed the deprecated top-level `customer`; `identities` is canonical. */
  identities?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                    */
/* -------------------------------------------------------------------------- */

export type FiskilWebhookEvent =
  | "consent.received"
  | "consent.updated"
  | "consent.revoked"
  | "common.identity.sync.completed"
  | "banking.accounts.sync.completed"
  | "banking.balances.sync.completed"
  | "banking.transactions.sync.completed"
  | "banking.transactions.basic.sync.completed"
  | "banking.transactions.recent.sync.completed"
  | (string & {});

/**
 * CONFIRMED 2026-09-11 against the Webhooks guide's documented payload. Note
 * that `event` is nested under `data`, NOT at the top level — Fiskil's own
 * code snippets destructure it from the top level and are wrong.
 *
 * `account_ids` is present only on `*.accounts.sync.completed`,
 * `*.balances.sync.completed` and the three banking transaction sync events.
 */
export interface FiskilWebhookPayload {
  message_id?: string;
  delivery_attempt?: number;
  publish_time?: string;
  data?: {
    /** The event name lives INSIDE `data`, not at the top level. */
    event?: FiskilWebhookEvent;
    end_user_id?: string;
    client_id?: string;
    consent_id?: string;
    institution_id?: string;
    account_ids?: string[];
    [key: string]: unknown;
  };
}

/** Events that mean new banking transaction data is available to pull. */
export const TRANSACTION_EVENTS: ReadonlySet<string> = new Set([
  "banking.transactions.sync.completed",
  "banking.transactions.basic.sync.completed",
  // Fired once during a first-time sync, when roughly 90 days of recent data
  // lands ahead of the full historical backfill.
  "banking.transactions.recent.sync.completed",
]);

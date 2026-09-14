import "server-only";

import { fiskilConfig } from "./config";
import { accessToken, invalidateToken } from "./token";
import { FiskilApiError, FiskilConfigError, type FiskilErrorBody } from "./errors";
import type {
  CreateEndUserResponse,
  FiskilAccount,
  FiskilAuthSession,
  FiskilBalance,
  FiskilConsent,
  FiskilEndUser,
  FiskilInstitution,
  IdentityResponse,
  ListEndUsersResponse,
  ListAccountsResponse,
  ListBalancesResponse,
  ListConsentsResponse,
  ListTransactionsResponse,
} from "./types";

/**
 * The Fiskil Data API, as one typed surface.
 *
 * Two things about this API are easy to get wrong and expensive to discover
 * late, so they are handled here once:
 *
 *  1. The version is a HEADER, not the path. The `/v1/` in every URL is a
 *     fixed namespace shared by all versions; `X-Fiskil-Version` selects the
 *     version. A v3 call to a `/v1/` path is correct.
 *  2. List shapes differ per endpoint in v3 — end users come back as
 *     `{ end_users }`, consents as `{ consents }`, and v1/v2 returned bare
 *     arrays. Callers get a normalised array from the helpers below.
 *
 * This module performs no database work and holds no tenancy logic: it is a
 * transport. Ownership is enforced by its callers in `feeds.ts`, which reach
 * Fiskil only with ids they have already proved the firm owns.
 */

type Query = Record<string, string | number | string[] | undefined>;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(path, baseUrl);
  if (!query) return url.toString();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    // `secondary_category` may be repeated for OR semantics.
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { query?: Query; body?: unknown; retryOn401?: boolean } = {},
): Promise<T> {
  const config = fiskilConfig();
  if (!config) throw new FiskilConfigError("Fiskil is not configured for this environment.");

  const { query, body, retryOn401 = true } = options;
  const token = await accessToken();

  const response = await fetch(buildUrl(config.baseUrl, path, query), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Fiskil-Version": config.apiVersion,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Feed data is never cached by the fetch layer: a stale balance is worse
    // than a slow one, and Next.js caches fetches by default.
    cache: "no-store",
  });

  // A 401 here means the cached token expired between the check and the call.
  // Drop it and retry exactly once, so a genuine credential failure still ends.
  if (response.status === 401 && retryOn401) {
    invalidateToken();
    return request<T>(method, path, { ...options, retryOn401: false });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let parsed: FiskilErrorBody | string = text;
    try {
      parsed = JSON.parse(text) as FiskilErrorBody;
    } catch {
      /* keep the raw text */
    }
    throw new FiskilApiError(response.status, parsed, path);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** v3 wraps lists in an object; v1/v2 returned bare arrays. Accept both. */
function unwrap<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const list = (payload as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

/** The `page[after]` cursor, which Fiskil hands back inside `links.next` as a path. */
export function cursorFrom(next: string | undefined): string | undefined {
  if (!next) return undefined;
  try {
    return new URL(next, "https://api.fiskil.com").searchParams.get("page[after]") ?? undefined;
  } catch {
    return undefined;
  }
}

export const fiskil = {
  /* ---------------------------------------------------------- end users -- */

  /**
   * Create the client's identity at Fiskil. Returns the new end user's id.
   *
   * The response uses `end_user_id`, not the `id` that the GET returns for the
   * same value; `id` is accepted as a fallback in case the shapes converge.
   */
  async createEndUser(input: {
    name: string;
    email: string;
    phone?: string;
    abn?: string;
  }): Promise<string> {
    const body = await request<CreateEndUserResponse>("POST", "/v1/end-users", { body: input });
    const id = body.end_user_id ?? body.id;
    if (!id) throw new FiskilApiError(502, "Create end user returned no id", "/v1/end-users");
    return id;
  },

  getEndUser(endUserId: string): Promise<FiskilEndUser> {
    return request<FiskilEndUser>("GET", `/v1/end-users/${encodeURIComponent(endUserId)}`);
  },

  /**
   * Every end user on the account. Used by `scripts/check-fiskil.ts` to prove
   * credentials against live data; the application itself always addresses a
   * known end user, because the one it may touch is the one on the Client row.
   */
  async listEndUsers(query: { "page[size]"?: number } = {}): Promise<FiskilEndUser[]> {
    const body = await request<ListEndUsersResponse>("GET", "/v1/end-users", { query });
    return unwrap<FiskilEndUser>(body, "end_users");
  },

  /* ------------------------------------------------------ auth sessions -- */

  /**
   * Start a consent. The returned `session_id` is what the browser hands to
   * the Link SDK — the client secret never leaves this process.
   *
   * `arrangement_id` re-authorises an existing CDR arrangement rather than
   * creating a new one, which is how an expiring consent is renewed without
   * the client re-selecting their accounts.
   */
  createAuthSession(input: {
    end_user_id: string;
    institution_id?: string;
    arrangement_id?: string;
    redirect_uri?: string;
    cancel_uri?: string;
  }): Promise<FiskilAuthSession> {
    return request<FiskilAuthSession>("POST", "/v1/auth/session", { body: input });
  },

  /* ----------------------------------------------------------- consents -- */

  async listConsents(query: { end_user_id?: string; active?: string } = {}): Promise<FiskilConsent[]> {
    const body = await request<ListConsentsResponse>("GET", "/v1/consent", { query });
    return unwrap<FiskilConsent>(body, "consents");
  },

  /** Addressed to the ARRANGEMENT id, not the consent id. */
  revokeConsent(arrangementId: string): Promise<void> {
    return request<void>("DELETE", `/v1/consent/${encodeURIComponent(arrangementId)}`);
  },

  /* ------------------------------------------------------- institutions -- */

  /** Uniquely among these endpoints, requires `client_id` as a query param. */
  async listInstitutions(): Promise<FiskilInstitution[]> {
    const config = fiskilConfig();
    const body = await request<unknown>("GET", "/v1/institutions", {
      query: { client_id: config?.clientId },
    });
    return unwrap<FiskilInstitution>(body, "institutions");
  },

  /* ------------------------------------------------------------ banking -- */

  /**
   * Accounts and balances are READ LIVE and their figures are never persisted
   * — Fiskil's banking guide is explicit that account and balance data must be
   * retrieved fresh. We keep only an opaque account reference plus a display
   * name, so transactions have a ledger anchor to hang from.
   */
  async listAccounts(endUserId: string): Promise<FiskilAccount[]> {
    const body = await request<ListAccountsResponse>("GET", "/v1/banking/accounts", {
      query: { end_user_id: endUserId },
    });
    return unwrap<FiskilAccount>(body, "accounts");
  },

  async listBalances(endUserId: string): Promise<FiskilBalance[]> {
    const body = await request<ListBalancesResponse>("GET", "/v1/banking/balances", {
      query: { end_user_id: endUserId },
    });
    return unwrap<FiskilBalance>(body, "balances");
  },

  /** One page. The caller follows `links.next` through `cursorFrom`. */
  listTransactions(query: {
    end_user_id: string;
    account_id?: string;
    from?: string;
    to?: string;
    status?: string;
    "page[size]"?: number;
    "page[after]"?: string;
  }): Promise<ListTransactionsResponse> {
    return request<ListTransactionsResponse>("GET", "/v1/banking/transactions", { query });
  },

  /**
   * Push a category correction back to Fiskil.
   *
   * The outward half of Coding Memory: when a person recodes a feed
   * transaction, Fiskil's own categoriser can learn from it. A hint to the
   * provider, never an accounting decision — the human has already told the
   * ledger, and this failing changes nothing about the books.
   *
   * CONFIRMED 2026-09-11 against the endpoint reference: the body is exactly
   * `fiskil_transaction_id` plus `secondary_category`. There is no end user,
   * no primary category. The secondary category "must be a valid secondary
   * category from the Fiskil taxonomy" — and that taxonomy is NOT published,
   * which is why the caller may only send a value it has actually observed
   * on a transaction Fiskil sent us. See `shareCategoryCorrection`.
   */
  overrideCategory(input: {
    fiskilTransactionId: string;
    secondaryCategory: string;
  }): Promise<{ message?: string }> {
    return request("POST", "/v1/banking/transactions/category", {
      body: {
        fiskil_transaction_id: input.fiskilTransactionId,
        secondary_category: input.secondaryCategory,
      },
    });
  },

  getIdentity(endUserId: string): Promise<IdentityResponse> {
    return request<IdentityResponse>("GET", "/v1/common/identity", {
      query: { end_user_id: endUserId },
    });
  },
};

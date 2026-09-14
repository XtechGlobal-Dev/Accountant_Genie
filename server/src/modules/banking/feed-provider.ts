import "server-only";

import { fiskil, cursorFrom } from "./fiskil/client";
import { fiskilConfig, fiskilConfigured, consentRedirects, webhookConfigured } from "./fiskil/config";
import {
  normaliseAccount,
  normaliseTransaction,
  parseFeedAmountCents,
  type NormalisedFeedAccount,
  type NormalisedFeedTransaction,
  type RejectReason,
} from "./fiskil/normalise";

/**
 * Live bank feeds through an accredited data recipient, behind one interface.
 *
 * Accountant Genie is not itself accredited under the Consumer Data Right; feeds run
 * through an intermediary that is. **Fiskil** is that intermediary, and this
 * interface is the only shape the rest of the codebase knows — no module
 * outside `banking/` imports `fiskil/` directly, so replacing the provider
 * means writing one class, not auditing the application.
 *
 * Without `FISKIL_CLIENT_ID` / `FISKIL_CLIENT_SECRET`, `getFeedProvider()`
 * returns null, the UI says so plainly, and statement upload remains the way
 * transactions arrive. Email feed requests are still recorded, so the work an
 * accountant does before credentials exist is not lost.
 *
 * ONE RULE ABOUT SHAPE: everything crossing this interface is already in our
 * units. Money is integer cents, signed, negative for money out. Provider
 * decimal strings are converted in `fiskil/normalise.ts` and nowhere else.
 */

export interface FeedAccount extends NormalisedFeedAccount {}

export interface FeedBalance {
  externalAccountId: string;
  /** Integer cents, or null when the provider did not give a parseable figure. */
  currentCents: number | null;
  availableCents: number | null;
  currency: string | null;
}

export interface FeedTransaction extends NormalisedFeedTransaction {}

export interface FeedTransactionPage {
  transactions: FeedTransaction[];
  /** Rows the provider sent that we could not map, by reason. Never silently dropped. */
  rejected: RejectReason[];
  /**
   * Unsettled authorisations, which carry no date and belong in no financial
   * year. Counted separately from rejections because they are not a failure —
   * they arrive normally once the bank posts them.
   */
  pending: number;
  /** Pass back as `cursor` to fetch the next page. Undefined when the list is exhausted. */
  nextCursor: string | undefined;
}

export interface FeedConsent {
  /** The provider's consent id. */
  externalConnectionId: string;
  /** What a revocation is addressed to. */
  arrangementId: string | null;
  institutionId: string | null;
  institutionName: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  consentedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface FeedInstitution {
  id: string;
  name: string;
  logo: string | null;
}

export interface FeedAuthSession {
  /** Handed to the browser for the Link SDK. Authorises nothing on its own. */
  sessionId: string;
  /** The hosted consent URL, for the redirect flow and for emailing a client. */
  authUrl: string;
  expiresAt: Date | null;
}

export interface FeedProvider {
  readonly name: string;

  /** Create the client's identity at the provider. Returns its external id. */
  createEndUser(input: { name: string; email: string; phone?: string; abn?: string }): Promise<string>;

  /**
   * Begin a consent. Pass `arrangementId` to renew an expiring CDR
   * arrangement instead of creating a new one — the client then re-authorises
   * without re-selecting accounts.
   */
  createAuthSession(input: {
    externalUserId: string;
    institutionId?: string | undefined;
    arrangementId?: string | undefined;
  }): Promise<FeedAuthSession>;

  /** The provider's authoritative consent list. Local rows are reconciled to it. */
  listConsents(externalUserId: string): Promise<FeedConsent[]>;

  revokeConsent(arrangementId: string): Promise<void>;

  listInstitutions(): Promise<FeedInstitution[]>;

  listAccounts(externalUserId: string): Promise<FeedAccount[]>;

  /** Read live on every request. Balance figures are NEVER persisted. */
  listBalances(externalUserId: string): Promise<FeedBalance[]>;

  listTransactionPage(input: {
    externalUserId: string;
    externalAccountId?: string | undefined;
    /** YYYY-MM-DD, inclusive. */
    from?: string | undefined;
    to?: string | undefined;
    cursor?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<FeedTransactionPage>;

  /** Live identity, for verifying the account holder matches the client. */
  getIdentity(externalUserId: string): Promise<Array<Record<string, unknown>>>;

  /**
   * Tell the provider a person coded a transaction differently. A hint to
   * their categoriser, never an accounting decision — failures are swallowed
   * by the caller, because the ledger is already correct without it.
   *
   * `secondaryCategory` must be a value from the provider's own taxonomy,
   * which Fiskil does not publish. The caller therefore only ever sends a
   * category it has OBSERVED on a transaction the provider sent us.
   */
  suggestCategory(input: {
    externalTransactionId: string;
    secondaryCategory: string;
  }): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Fiskil                                                                     */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 500;

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

class FiskilProvider implements FeedProvider {
  readonly name = "fiskil";

  createEndUser(input: { name: string; email: string; phone?: string; abn?: string }) {
    return fiskil.createEndUser(input);
  }

  async createAuthSession(input: {
    externalUserId: string;
    institutionId?: string | undefined;
    arrangementId?: string | undefined;
  }): Promise<FeedAuthSession> {
    const { redirectUri, cancelUri } = consentRedirects();
    const session = await fiskil.createAuthSession({
      end_user_id: input.externalUserId,
      ...(input.institutionId ? { institution_id: input.institutionId } : {}),
      ...(input.arrangementId ? { arrangement_id: input.arrangementId } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      ...(cancelUri ? { cancel_uri: cancelUri } : {}),
    });
    return {
      sessionId: session.session_id,
      authUrl: session.auth_url,
      // `expires_at` is Unix SECONDS, not milliseconds. Auth sessions live five days.
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    };
  }

  async listConsents(externalUserId: string): Promise<FeedConsent[]> {
    const consents = await fiskil.listConsents({ end_user_id: externalUserId });
    return consents.flatMap((consent) => {
      const externalConnectionId = consent.consent_id ?? consent.arrangement_id;
      if (!externalConnectionId) return [];
      // Revocation beats expiry: a consent the client withdrew is recorded as
      // withdrawn even if its end date has also passed.
      const status: FeedConsent["status"] = consent.revoked_at
        ? "REVOKED"
        : consent.active === false
          ? "EXPIRED"
          : "ACTIVE";
      return [
        {
          externalConnectionId,
          arrangementId: consent.arrangement_id ?? null,
          institutionId: consent.institution_id ?? null,
          institutionName: consent.institution_name ?? null,
          status,
          consentedAt: asDate(consent.created_at),
          expiresAt: asDate(consent.expires_at),
          revokedAt: asDate(consent.revoked_at),
        },
      ];
    });
  }

  revokeConsent(arrangementId: string): Promise<void> {
    return fiskil.revokeConsent(arrangementId);
  }

  async listInstitutions(): Promise<FeedInstitution[]> {
    const institutions = await fiskil.listInstitutions();
    return institutions
      .filter((institution) => Boolean(institution.id))
      .map((institution) => ({
        id: institution.id,
        name: institution.name ?? institution.id,
        logo: institution.logo ?? null,
      }));
  }

  async listAccounts(externalUserId: string): Promise<FeedAccount[]> {
    const accounts = await fiskil.listAccounts(externalUserId);
    return accounts.flatMap((account) => {
      const normalised = normaliseAccount(account);
      return normalised ? [normalised] : [];
    });
  }

  async listBalances(externalUserId: string): Promise<FeedBalance[]> {
    const balances = await fiskil.listBalances(externalUserId);
    return balances.flatMap((balance) => {
      const externalAccountId = balance.account_id;
      if (!externalAccountId) return [];
      return [
        {
          externalAccountId,
          currentCents: parseFeedAmountCents(balance.current_balance),
          availableCents: parseFeedAmountCents(balance.available_balance),
          currency: balance.currency ?? null,
        },
      ];
    });
  }

  async listTransactionPage(input: {
    externalUserId: string;
    externalAccountId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<FeedTransactionPage> {
    const page = await fiskil.listTransactions({
      end_user_id: input.externalUserId,
      ...(input.externalAccountId ? { account_id: input.externalAccountId } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.cursor ? { "page[after]": input.cursor } : {}),
      "page[size]": input.pageSize ?? PAGE_SIZE,
    });

    const transactions: FeedTransaction[] = [];
    const rejected: RejectReason[] = [];
    let pending = 0;
    for (const row of page.transactions ?? []) {
      const result = normaliseTransaction(row);
      if (result.ok) transactions.push(result.transaction);
      else if (result.reason === "pending") pending += 1;
      else rejected.push(result.reason);
    }

    return { transactions, rejected, pending, nextCursor: cursorFrom(page.links?.next) };
  }

  async getIdentity(externalUserId: string): Promise<Array<Record<string, unknown>>> {
    const identity = await fiskil.getIdentity(externalUserId);
    return identity.identities ?? [];
  }

  async suggestCategory(input: {
    externalTransactionId: string;
    secondaryCategory: string;
  }): Promise<void> {
    await fiskil.overrideCategory({
      fiskilTransactionId: input.externalTransactionId,
      secondaryCategory: input.secondaryCategory,
    });
  }
}

let cached: FeedProvider | null | undefined;

export function getFeedProvider(): FeedProvider | null {
  if (cached !== undefined) return cached;
  cached = fiskilConfigured() ? new FiskilProvider() : null;
  return cached;
}

export function feedProviderConfigured(): boolean {
  return getFeedProvider() !== null;
}

/** The provider's name for display, even when it is not configured. */
export function feedProviderName(): string {
  return "Fiskil";
}

export { fiskilConfig };

/**
 * Whether the provider can PUSH new data to us.
 *
 * This is the difference between a feed that keeps itself up to date and one
 * that only moves when somebody presses Sync now. Fiskil issues the signing
 * secret only when a publicly reachable webhook endpoint is registered, so the
 * usual local state is "connected, but nothing will arrive on its own" — and
 * the screen has to say so rather than promising automatic delivery.
 */
export function feedDeliveryIsAutomatic(): boolean {
  return feedProviderConfigured() && webhookConfigured();
}

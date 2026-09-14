import "server-only";

import { parseCents } from "@/shared/money";
import type { FiskilAccount, FiskilTransaction } from "./types";

/**
 * Turning Fiskil payloads into our domain shapes.
 *
 * CONFIRMED 2026-09-11 against 781 live sandbox transactions. Fiskil does not
 * publish the `TransactionV2` field list — checked by three documentation
 * routes, all of which stop at the type name — so these names come from the
 * wire, not from a guess. Four of them contradicted the obvious assumption,
 * and every one would have failed silently:
 *
 *   `posting_date_time`  NOT `posted_date_time`. The near-miss is the whole
 *                        problem: the fallback to execution still produced a
 *                        date, so every transaction would have looked fine
 *                        while `postedAt` was permanently null.
 *   `category` NESTED    `category.primary_category`, not a flat key. A flat
 *                        lookup finds nothing and silently drops every
 *                        category — the signal the AI tier now relies on.
 *   `fiskil_id`          Fiskil's own stable id, and what the category
 *                        override endpoint means by `fiskil_transaction_id`.
 *                        `transaction_id` is the INSTITUTION's id and is a
 *                        different value. Using the wrong one breaks the
 *                        Coding Memory feedback loop.
 *   PENDING rows         carry NO date field of any kind.
 *
 * The aliases are kept as a second line of defence because CDR payloads vary
 * by institution and only one data holder is represented above, but the
 * confirmed key is first in every list. The untouched payload is still always
 * persisted in `BankTransaction.feedRaw`.
 *
 * CONFIRMED from the Banking guide: "prefer the posted datetime when present,
 * and fall back to the execution datetime when it isn't, rather than assuming
 * a single field is always populated." That is what `date` does below.
 *
 * Money is the part that must not be approximate. `amount` arrives as a
 * decimal STRING; it is converted to integer cents by string arithmetic and a
 * transaction whose amount cannot be parsed exactly is REJECTED rather than
 * rounded into the ledger. See the Money rules in CLAUDE.md §6.
 */

function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A provider amount into integer cents.
 *
 * `parseCents` refuses a third decimal place, which is right for a figure a
 * person typed — it is a typo. From a bank it is not a typo, it is a currency
 * with more precision or a rate-derived value, so the extra digits are rounded
 * half away from zero (matching the CDR's own rounding) rather than dropping
 * the transaction. Still string arithmetic throughout: no `parseFloat`.
 */
export function parseFeedAmountCents(value: unknown): number | null {
  const text = asString(value);
  if (text === null) return null;

  const exact = parseCents(text);
  if (exact !== null) return exact;

  const match = /^([+-]?)(\d+)\.(\d{3,})$/.exec(text.replace(/[$,\s]/g, ""));
  if (!match) return null;
  const [, sign, whole, frac] = match as unknown as [string, string, string, string];

  const cents = Number(whole) * 100 + Number(frac.slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  // Round half away from zero on the first dropped digit.
  const rounded = Number(frac[2]) >= 5 ? cents + 1 : cents;
  return sign === "-" ? -rounded : rounded;
}

export interface NormalisedFeedTransaction {
  /**
   * Fiskil's own stable id (`bank_tx_…`). This is the identity we store and
   * the value the category override endpoint calls `fiskil_transaction_id`.
   */
  externalId: string;
  externalAccountId: string;
  /** Signed cents. Negative is money out, per CLAUDE.md §6. */
  amountCents: number;
  description: string;
  /** The reporting date: posted, falling back to execution. */
  date: Date;
  postedAt: Date | null;
  executionAt: Date | null;
  feedCategory: string | null;
  feedSubcategory: string | null;
  /** VERY_HIGH | HIGH | MEDIUM | LOW — how sure Fiskil is of its own category. */
  feedCategoryConfidence: string | null;
  /** ISO 18245 merchant category code, e.g. "5812" for eating places. */
  feedMerchantCode: string | null;
  raw: FiskilTransaction;
}

export type RejectReason = "no-id" | "no-account" | "no-amount" | "no-date";

export type NormaliseResult =
  | { ok: true; transaction: NormalisedFeedTransaction }
  /** Not an error: a real transaction that is not yet ledgerable. */
  | { ok: false; reason: "pending"; externalId: string }
  | { ok: false; reason: RejectReason; externalId: string | null };

/** The nested `category` object, which is where the categories actually live. */
function categoryOf(record: Record<string, unknown>): Record<string, unknown> {
  const nested = record.category;
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : record;
}

/**
 * A rejected row is never silently discarded — the caller counts rejections
 * onto the sync run, so a mapping that stops working is visible as a number
 * rather than as quietly missing transactions.
 */
export function normaliseTransaction(input: FiskilTransaction): NormaliseResult {
  const record = input as Record<string, unknown>;

  // `fiskil_id` first: it is Fiskil's stable identifier and the one their
  // category override endpoint expects. `transaction_id` is the institution's
  // and is a DIFFERENT value on the same transaction.
  const externalId = asString(pick(record, ["fiskil_id", "transaction_id", "id", "transactionId"]));
  if (!externalId) return { ok: false, reason: "no-id", externalId: null };

  const externalAccountId = asString(pick(record, ["account_id", "accountId"]));
  if (!externalAccountId) return { ok: false, reason: "no-account", externalId };

  /**
   * An unsettled authorisation is not a source document.
   *
   * It can change amount, or vanish entirely, before the bank posts it. The
   * ledger is built from settled facts, so PENDING rows are skipped outright
   * — not merely the dateless ones. In live sandbox data most PENDING rows
   * carry no date at all, but some carry an execution datetime, and letting
   * those through would put a provisional figure in front of an accountant
   * with nothing marking it provisional.
   *
   * Nothing is lost. `fiskil_id` is stable across settlement, so the row
   * arrives on the next sync as POSTED and inserts exactly once.
   */
  const status = asString(pick(record, ["status", "transaction_status"]));
  if (status?.toUpperCase() === "PENDING") return { ok: false, reason: "pending", externalId };

  const amountCents = parseFeedAmountCents(pick(record, ["amount", "value"]));
  if (amountCents === null) return { ok: false, reason: "no-amount", externalId };

  const postedAt = asDate(
    pick(record, ["posting_date_time", "posted_date_time", "posted_at", "postingDateTime"]),
  );
  const executionAt = asDate(
    pick(record, ["execution_date_time", "execution_at", "executionDateTime", "value_date_time"]),
  );

  // Fiskil's own guidance: prefer the posted datetime, fall back to execution.
  // A settled transaction with neither cannot be placed in a financial year,
  // so it cannot reach a report and is a genuine mapping failure.
  const date = postedAt ?? executionAt;
  if (!date) return { ok: false, reason: "no-date", externalId };

  const category = categoryOf(record);

  return {
    ok: true,
    transaction: {
      externalId,
      externalAccountId,
      amountCents,
      description:
        asString(pick(record, ["description", "merchant_name", "text", "reference"])) ??
        "(no description)",
      date,
      postedAt,
      executionAt,
      feedCategory: asString(pick(category, ["primary_category", "primaryCategory"])),
      feedSubcategory: asString(pick(category, ["secondary_category", "secondaryCategory"])),
      feedCategoryConfidence: asString(pick(category, ["confidence_level", "confidenceLevel"])),
      feedMerchantCode: asString(pick(record, ["merchant_category_code", "merchantCategoryCode"])),
      raw: input,
    },
  };
}

export interface NormalisedFeedAccount {
  externalId: string;
  name: string;
  /** Last four digits only. A full account number is never stored. */
  mask: string | null;
  kind: "BANK" | "CREDIT_CARD";
  productCategory: string | null;
}

/**
 * CDR product categories that are a credit facility rather than a deposit
 * account. The distinction matters to the balance sheet: one is an asset, the
 * other a liability, and the chart of accounts has separate lines for them.
 */
const CREDIT_CATEGORIES: ReadonlySet<string> = new Set([
  "CRED_AND_CHRG_CARDS",
  "CREDIT_AND_CHARGE_CARDS",
]);

/**
 * CDR product categories that hold money the business actually has.
 *
 * Only these may become the Cash at Bank account. Observed in live sandbox
 * data: a consent commonly includes the client's MORTGAGE alongside their
 * transaction accounts, and "the first account we saw" would happily make a
 * home loan the balance sheet's cash line — a liability reported as an asset,
 * in the one field the whole balance sheet balances against.
 *
 * The list is deliberately an allowlist. An unrecognised product category is
 * not a deposit account until someone says so.
 */
const DEPOSIT_CATEGORIES: ReadonlySet<string> = new Set([
  "TRANS_AND_SAVINGS_ACCOUNTS",
  "TERM_DEPOSITS",
  "REGULATED_TRUST_ACCOUNTS",
]);

/** Whether this account may serve as the client's Cash at Bank account. */
export function isDepositAccount(productCategory: string | null): boolean {
  return productCategory !== null && DEPOSIT_CATEGORIES.has(productCategory);
}

export function normaliseAccount(input: FiskilAccount): NormalisedFeedAccount | null {
  const record = input as Record<string, unknown>;
  const externalId = asString(pick(record, ["account_id", "id", "accountId"]));
  if (!externalId) return null;

  const productCategory = asString(pick(record, ["product_category", "productCategory"]));
  const maskSource = asString(pick(record, ["masked_number", "maskedNumber", "account_number"]));
  const digits = maskSource?.replace(/\D/g, "") ?? "";

  return {
    externalId,
    name:
      asString(pick(record, ["display_name", "nickname", "displayName", "product_name"])) ??
      "Bank account",
    mask: digits.length >= 3 ? digits.slice(-4) : null,
    kind: productCategory && CREDIT_CATEGORIES.has(productCategory) ? "CREDIT_CARD" : "BANK",
    productCategory,
  };
}

import { describe, expect, it } from "vitest";
import {
  isDepositAccount,
  normaliseAccount,
  normaliseTransaction,
  parseFeedAmountCents,
} from "./normalise";

/**
 * The Fiskil edge is where a decimal string from a bank becomes integer cents
 * in our ledger. Everything downstream — GST, the journal, the BAS — assumes
 * that conversion is exact, so these are the tests that protect the money.
 */

describe("parseFeedAmountCents", () => {
  it("converts two-decimal strings exactly", () => {
    expect(parseFeedAmountCents("123.45")).toBe(12_345);
    expect(parseFeedAmountCents("-123.45")).toBe(-12_345);
    expect(parseFeedAmountCents("0.01")).toBe(1);
    expect(parseFeedAmountCents("1000")).toBe(100_000);
  });

  it("does not lose a cent to floating point", () => {
    // 0.29 * 100 is 28.999999999999996 in IEEE 754. String arithmetic is not.
    expect(parseFeedAmountCents("0.29")).toBe(29);
    expect(parseFeedAmountCents("1.10")).toBe(110);
    expect(parseFeedAmountCents("-8.07")).toBe(-807);
  });

  it("accepts a number as well as a string", () => {
    expect(parseFeedAmountCents(42.5)).toBe(4_250);
  });

  it("rounds extra precision half away from zero rather than dropping the row", () => {
    // A bank figure with three decimals is real data, not a typo, so it is
    // rounded — unlike a human-typed amount, which `parseCents` rejects.
    expect(parseFeedAmountCents("1.005")).toBe(101);
    expect(parseFeedAmountCents("1.004")).toBe(100);
    expect(parseFeedAmountCents("-1.005")).toBe(-101);
    expect(parseFeedAmountCents("2.9999")).toBe(300);
  });

  it("returns null for anything that is not an amount", () => {
    expect(parseFeedAmountCents(null)).toBeNull();
    expect(parseFeedAmountCents(undefined)).toBeNull();
    expect(parseFeedAmountCents("")).toBeNull();
    expect(parseFeedAmountCents("N/A")).toBeNull();
  });
});

describe("normaliseTransaction", () => {
  /** The shape Fiskil actually sends, taken from live sandbox data. */
  const base = {
    fiskil_id: "bank_tx_abc123",
    transaction_id: "institution-opaque-id",
    account_id: "acc-1",
    amount: "-42.50",
    currency: "AUD",
    description: "WOOLWORTHS 1234",
    status: "POSTED",
    posting_date_time: "2026-03-01T04:00:00Z",
    execution_date_time: "2026-03-01T04:00:00Z",
    category: {
      primary_category: "GENERAL_MERCHANDISE",
      secondary_category: "GENERAL_MERCHANDISE_SUPERMARKETS",
      confidence_level: "VERY_HIGH",
    },
    merchant_category_code: "5411",
  };

  it("maps a well-formed transaction", () => {
    const result = normaliseTransaction(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transaction.externalAccountId).toBe("acc-1");
    expect(result.transaction.amountCents).toBe(-4_250);
    expect(result.transaction.description).toBe("WOOLWORTHS 1234");
    // The untouched payload is always kept, so a wrong mapping is recoverable.
    expect(result.transaction.raw).toBe(base);
  });

  it("identifies the transaction by fiskil_id, not the institution's id", () => {
    // These are DIFFERENT values on the same transaction. `fiskil_id` is what
    // the category override endpoint means by `fiskil_transaction_id`, so
    // using the institution's id silently breaks the feedback loop.
    const result = normaliseTransaction(base);
    expect(result.ok && result.transaction.externalId).toBe("bank_tx_abc123");
  });

  it("reads posting_date_time, not the posted_date_time spelling", () => {
    // The near-miss is the danger: with only `posted_date_time` in the alias
    // list the fallback to execution still yields a date, so every row looks
    // fine while postedAt is permanently null.
    const result = normaliseTransaction(base);
    expect(result.ok && result.transaction.postedAt?.toISOString()).toBe("2026-03-01T04:00:00.000Z");
  });

  it("prefers the posted date and falls back to execution", () => {
    const posted = normaliseTransaction({
      ...base,
      posting_date_time: "2026-03-01T00:00:00Z",
      execution_date_time: "2026-02-28T00:00:00Z",
    });
    expect(posted.ok && posted.transaction.date.toISOString()).toBe("2026-03-01T00:00:00.000Z");

    const { posting_date_time: _omitted, ...withoutPosted } = base;
    const executed = normaliseTransaction({
      ...withoutPosted,
      execution_date_time: "2026-02-28T00:00:00Z",
    });
    expect(executed.ok && executed.transaction.date.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(executed.ok && executed.transaction.postedAt).toBeNull();
  });

  it("reads the NESTED category object", () => {
    // Categories live under `category`, not flat on the transaction. A flat
    // lookup finds nothing and silently drops every category.
    const result = normaliseTransaction(base);
    expect(result.ok && result.transaction.feedCategory).toBe("GENERAL_MERCHANDISE");
    expect(result.ok && result.transaction.feedSubcategory).toBe("GENERAL_MERCHANDISE_SUPERMARKETS");
    expect(result.ok && result.transaction.feedCategoryConfidence).toBe("VERY_HIGH");
    expect(result.ok && result.transaction.feedMerchantCode).toBe("5411");
  });

  it("skips an unsettled authorisation even when it carries a date", () => {
    // A pending row can change amount or vanish before the bank posts it, so
    // it is not a source document. It returns as POSTED on a later sync under
    // the same fiskil_id, so nothing is lost and nothing is duplicated.
    const withDate = normaliseTransaction({ ...base, status: "PENDING" });
    expect(withDate).toMatchObject({ ok: false, reason: "pending" });

    const { posting_date_time: _p, execution_date_time: _e, ...dateless } = base;
    expect(normaliseTransaction({ ...dateless, status: "PENDING" })).toMatchObject({
      ok: false,
      reason: "pending",
    });
  });

  it("rejects, with a reason, rather than guessing", () => {
    const { fiskil_id: _f, transaction_id: _t, ...noId } = base;
    expect(normaliseTransaction(noId)).toMatchObject({ ok: false, reason: "no-id" });

    const { account_id: _account, ...noAccount } = base;
    expect(normaliseTransaction(noAccount)).toMatchObject({ ok: false, reason: "no-account" });

    // An unparseable amount must never become a zero in the ledger.
    expect(normaliseTransaction({ ...base, amount: "n/a" })).toMatchObject({
      ok: false,
      reason: "no-amount",
    });

    // A SETTLED transaction with no date cannot be placed in a financial
    // year, so it cannot reach a report.
    const { posting_date_time: _posted, execution_date_time: _exec, ...noDate } = base;
    expect(normaliseTransaction(noDate)).toMatchObject({ ok: false, reason: "no-date" });
  });
});

describe("normaliseAccount", () => {
  it("keeps only the last four digits of an account number", () => {
    const account = normaliseAccount({
      account_id: "acc-1",
      display_name: "Business One",
      masked_number: "XXXX-XXXX-1234-5678",
      product_category: "TRANS_AND_SAVINGS_ACCOUNTS",
    });
    expect(account?.mask).toBe("5678");
    expect(account?.kind).toBe("BANK");
  });

  it("classifies a credit facility as a credit card, not a bank account", () => {
    // The balance sheet treats one as an asset and the other as a liability.
    const account = normaliseAccount({
      account_id: "acc-2",
      display_name: "Business Visa",
      product_category: "CRED_AND_CHRG_CARDS",
    });
    expect(account?.kind).toBe("CREDIT_CARD");
  });

  it("returns null without an account id, since nothing could anchor to it", () => {
    expect(normaliseAccount({ display_name: "Orphan" })).toBeNull();
  });
});

describe("isDepositAccount", () => {
  it("accepts accounts that hold money the business has", () => {
    expect(isDepositAccount("TRANS_AND_SAVINGS_ACCOUNTS")).toBe(true);
    expect(isDepositAccount("TERM_DEPOSITS")).toBe(true);
  });

  it("refuses credit facilities, which are liabilities", () => {
    // A consent routinely includes the client's mortgage alongside their
    // transaction accounts. Letting one become the Cash at Bank account would
    // report a liability as an asset in the single field the balance sheet
    // balances against.
    expect(isDepositAccount("RESIDENTIAL_MORTGAGES")).toBe(false);
    expect(isDepositAccount("CRED_AND_CHRG_CARDS")).toBe(false);
    expect(isDepositAccount("BUSINESS_LOANS")).toBe(false);
  });

  it("refuses anything it does not recognise, including null", () => {
    // An allowlist on purpose: an unknown product category is not a deposit
    // account until a person says it is.
    expect(isDepositAccount(null)).toBe(false);
    expect(isDepositAccount("SOME_NEW_CDR_CATEGORY")).toBe(false);
  });
});

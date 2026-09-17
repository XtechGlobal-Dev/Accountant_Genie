import { describe, expect, it } from "vitest";
import { snapshotGst } from "./snapshot";

/**
 * The snapshot is what the BAS reads years later. A wrong one here is a
 * wrong 1B that no report can detect, because every report trusts the line.
 */

describe("snapshotGst", () => {
  it("takes a registered client's GST from the account, gross / 11, on the natural side", () => {
    expect(snapshotGst({ source: "MANUAL", accountTreatment: "GST_ON_EXPENSES", debitCents: 330_000, creditCents: 0, gstRegistered: true }))
      .toEqual({ gstCents: 30_000, gstTreatment: "GST_ON_EXPENSES" });
    expect(snapshotGst({ source: "BANK", accountTreatment: "GST_ON_INCOME", debitCents: 0, creditCents: 1_100_000, gstRegistered: true }))
      .toEqual({ gstCents: 100_000, gstTreatment: "GST_ON_INCOME" });
    // A refund on an income account is a debit: negative GST, netted off 1A.
    expect(snapshotGst({ source: "BANK", accountTreatment: "GST_ON_INCOME", debitCents: 1_100, creditCents: 0, gstRegistered: true }))
      .toEqual({ gstCents: -100, gstTreatment: "GST_ON_INCOME" });
  });

  it("keeps the treatment but zero GST for an unregistered client", () => {
    expect(snapshotGst({ source: "MANUAL", accountTreatment: "GST_ON_EXPENSES", debitCents: 330_000, creditCents: 0, gstRegistered: false }))
      .toEqual({ gstCents: 0, gstTreatment: "GST_ON_EXPENSES" });
  });

  it("carries no GST on a GST-free, input-taxed or excluded account", () => {
    for (const t of ["GST_FREE_EXPENSES", "INPUT_TAXED", "BAS_EXCLUDED"] as const) {
      expect(snapshotGst({ source: "MANUAL", accountTreatment: t, debitCents: 1_000, creditCents: 0, gstRegistered: true }))
        .toEqual({ gstCents: 0, gstTreatment: t });
    }
  });

  it("makes an opening balance BAS-excluded whatever the account says — it is not a purchase in the period", () => {
    // A $40,000 ute brought forward on a capital-treatment asset account. Left
    // to the account it would report $40,000 at G10 and $3,636.36 at 1B.
    expect(snapshotGst({ source: "OPENING", accountTreatment: "GST_ON_CAPITAL", debitCents: 4_000_000, creditCents: 0, gstRegistered: true }))
      .toEqual({ gstCents: 0, gstTreatment: "BAS_EXCLUDED" });
    expect(snapshotGst({ source: "OPENING", accountTreatment: "GST_ON_INCOME", debitCents: 0, creditCents: 500_000, gstRegistered: true }))
      .toEqual({ gstCents: 0, gstTreatment: "BAS_EXCLUDED" });
  });
});

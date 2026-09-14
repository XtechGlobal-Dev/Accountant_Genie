import { describe, expect, it } from "vitest";
import type { LedgerLine } from "./aggregate";
import { journalsToMyobTxt, journalsToXeroCsv } from "./exports";

const base = {
  date: new Date("2026-07-14T00:00:00.000Z"),
  reference: "INV-2041",
  entryDescription: "Progress claim, Kellyville",
  lineDescription: null,
  accountName: "x",
  accountType: "ASSET" as const,
  gstCents: 0,
};
const LINES: LedgerLine[] = [
  { ...base, entryId: "e1", accountId: "a701", accountCode: 701, debitCents: 1_100_000, creditCents: 0, gstTreatment: "BAS_EXCLUDED" },
  { ...base, entryId: "e1", accountId: "a200", accountCode: 200, accountType: "INCOME", debitCents: 0, creditCents: 1_100_000, gstCents: 100_000, gstTreatment: "GST_ON_INCOME" },
];

describe("journalsToXeroCsv", () => {
  it("writes one signed amount per line with Xero tax rate names and AU dates", () => {
    const csv = journalsToXeroCsv(LINES);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount,TrackingName1,TrackingOption1");
    expect(rows[1]).toBe('"Progress claim, Kellyville",14/07/2026,,701,BAS Excluded,11000.00,,');
    expect(rows[2]).toBe('"Progress claim, Kellyville",14/07/2026,,200,GST on Income,-11000.00,,');
  });

  it("sums to zero per journal", () => {
    const amounts = journalsToXeroCsv(LINES).trim().split("\r\n").slice(1).map((r) => Number(r.split(",").at(-3)));
    expect(amounts.reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe("journalsToMyobTxt", () => {
  it("writes tab-delimited debit and credit columns with MYOB tax codes", () => {
    const rows = journalsToMyobTxt(LINES).trim().split("\r\n");
    expect(rows[0]?.split("\t")[0]).toBe("Journal Number");
    expect(rows[1]?.split("\t")).toEqual(["GJ000001", "14/07/2026", "Progress claim, Kellyville", "Y", "701", "11000.00", "", "", "", "N-T"]);
    expect(rows[2]?.split("\t")).toEqual(["GJ000001", "14/07/2026", "Progress claim, Kellyville", "Y", "200", "", "11000.00", "", "", "GST"]);
  });
});

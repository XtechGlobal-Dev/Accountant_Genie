import { describe, expect, it } from "vitest";
import {
  detectColumns,
  normaliseDescription,
  parseStatementAmount,
  parseStatementCsv,
  parseStatementDate,
} from "./parse";

describe("parseStatementDate", () => {
  it("reads Australian day-first dates", () => {
    expect(parseStatementDate("03/07/2026")?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(parseStatementDate("3/7/26")?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(parseStatementDate("03-07-2026")?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
  });

  it("reads ISO and month-name dates", () => {
    expect(parseStatementDate("2026-07-03")?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(parseStatementDate("3 Jul 2026")?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(parseStatementDate("03-Sept-2026")?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("rejects impossible dates and noise", () => {
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("Opening balance")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads signed, bracketed and suffixed amounts as cents", () => {
    expect(parseStatementAmount("-1,234.56")).toBe(-123456);
    expect(parseStatementAmount("(12.00)")).toBe(-1200);
    expect(parseStatementAmount("12.00 DR")).toBe(-1200);
    expect(parseStatementAmount("12.00 CR")).toBe(1200);
    expect(parseStatementAmount("$45")).toBe(4500);
  });

  it("treats blank as absent, not zero", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount(undefined)).toBeNull();
  });
});

describe("normaliseDescription", () => {
  it("lower-cases and strips card and reference noise", () => {
    expect(normaliseDescription("VISA PURCHASE BUNNINGS 6421 ALEXANDRIA CARD 4523")).toBe(
      "bunnings alexandria",
    );
    expect(normaliseDescription("EFTPOS Debit COLES 0349 12/08 14:32 REF 123456789")).toBe("coles");
    expect(normaliseDescription("  Telstra   Bill  Payment ")).toBe("telstra bill payment");
  });

  it("makes the same merchant read the same way", () => {
    expect(normaliseDescription("AWS AUSTRALIA 123456789 SYDNEY")).toBe(
      normaliseDescription("AWS Australia 987654321 SYDNEY"),
    );
  });
});

describe("detectColumns", () => {
  it("finds date, description and amount columns by common headers", () => {
    expect(detectColumns(["Date", "Description", "Amount", "Balance"])).toEqual({
      date: "Date",
      description: "Description",
      amount: "Amount",
      debit: undefined,
      credit: undefined,
      balance: "Balance",
    });
  });

  it("accepts debit/credit pairs instead of one amount column", () => {
    const map = detectColumns(["Transaction Date", "Narrative", "Debit", "Credit"]);
    expect(map?.debit).toBe("Debit");
    expect(map?.credit).toBe("Credit");
  });

  it("gives up when the essentials are missing", () => {
    expect(detectColumns(["Foo", "Bar"])).toBeNull();
    expect(detectColumns(["Date", "Description"])).toBeNull();
  });
});

describe("parseStatementCsv", () => {
  it("parses a headed file with one signed amount column", () => {
    const csv = [
      "Date,Description,Amount,Balance",
      "01/07/2026,OPENING DEPOSIT,\"1,000.00\",\"1,000.00\"",
      "02/07/2026,BUNNINGS 6421,-88.50,911.50",
    ].join("\n");
    const result = parseStatementCsv(csv);
    expect(result.failed).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({
      amountCents: -8850,
      balanceCents: 91150,
      normalised: "bunnings",
    });
  });

  it("parses a headerless positional export", () => {
    const csv = ["03/07/2026,-15.00,ACCOUNT KEEPING FEE,985.00", "04/07/2026,250.00,PAYMENT RECEIVED INV 12,1235.00"].join("\n");
    const result = parseStatementCsv(csv);
    expect(result.columns.positional).toBe(true);
    expect(result.rows.map((r) => r.amountCents)).toEqual([-1500, 25000]);
  });

  it("combines debit and credit columns into a signed amount", () => {
    const csv = ["Date,Narrative,Debit,Credit", "05/07/2026,Rent,330.00,", "06/07/2026,Sales,,110.00"].join("\n");
    const result = parseStatementCsv(csv);
    expect(result.rows.map((r) => r.amountCents)).toEqual([-33000, 11000]);
  });

  it("reports unreadable rows and keeps the rest", () => {
    const csv = ["Date,Description,Amount", "not a date,Thing,1.00", "07/07/2026,,2.00", "08/07/2026,Good,3.00"].join("\n");
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.failed.map((f) => f.reason)).toEqual([
      'Unreadable date "not a date"',
      "Empty description",
    ]);
  });

  it("finds the header below a bank's letterhead, codes from the description not the reference, and skips the footer", () => {
    // The shape a "business bank statement" export takes: preamble, a
    // summary row that itself mentions Money in / Money out, the real
    // header, the lines, then a reconciliation note and a page footer.
    const statement = [
      "SOUTHERN CROSS,,,BUSINESS BANK STATEMENT,,",
      "Account holder,Singh Kitchen Pty Ltd,Statement period,1 September 2026 to 30 September 2026,,",
      "BSB / account,000-000 / XXXX 4821,Currency,AUD,,",
      "Opening balance,Money in,Money out,Closing balance,Transaction count,",
      '"$25,000.00","$11,000.00","$18,810.00","$17,190.00",,5',
      "Date,Reference,Transaction description,Money in,Money out,Balance",
      '02-Sep-26,EFT-0902,EFTPOS settlement - restaurant sales,"$11,000.00",,"$36,000.00"',
      '04-Sep-26,SUP-0904,Greenfield Produce Markets - GST-free ingredients,,"$2,200.00","$33,800.00"',
      '10-Sep-26,CAPEX-0910,Precision Kitchen Systems - commercial oven,,"$11,000.00","$17,300.00"',
      '"Reconciliation: $25,000.00 + $11,000.00 - $18,810.00 = $17,190.00.",,,,,',
      "SAMPLE / FICTIONAL - Singh Kitchen,,,,,Page 1",
    ].join("\n");
    const result = parseStatementCsv(statement);
    expect(result.failed).toEqual([]);
    expect(result.columns).toMatchObject({ date: "Date", description: "Transaction description", credit: "Money in", debit: "Money out", balance: "Balance" });
    expect(result.rows.map((r) => [r.date.toISOString().slice(0, 10), r.amountCents, r.description, r.balanceCents])).toEqual([
      ["2026-09-02", 1_100_000, "EFTPOS settlement - restaurant sales", 3_600_000],
      ["2026-09-04", -220_000, "Greenfield Produce Markets - GST-free ingredients", 3_380_000],
      ["2026-09-10", -1_100_000, "Precision Kitchen Systems - commercial oven", 1_730_000],
    ]);
    // Five letterhead rows above the header, two note rows below the data.
    expect(result.skipped).toBe(7);
    // Row indexes still point at the file, for the failed-rows report.
    expect(result.rows[0]?.index).toBe(6);
  });

  it("falls back to a Reference column only when nothing names the description", () => {
    expect(detectColumns(["Date", "Reference", "Amount"])?.description).toBe("Reference");
    expect(detectColumns(["Date", "Reference", "Transaction description", "Amount"])?.description).toBe("Transaction description");
  });

  it("still reports a row with an amount but no readable date", () => {
    const result = parseStatementCsv(["Date,Description,Amount", "32/13/2026,Impossible,-10.00", "01/07/2026,Fine,-5.00"].join("\n"));
    expect(result.rows).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toMatch(/Unreadable date/);
  });

  it("fails clearly when the header has no usable columns", () => {
    const result = parseStatementCsv("Foo,Bar\n1,2");
    expect(result.rows).toEqual([]);
    expect(result.failed[0]?.reason).toMatch(/Could not find/);
  });
});

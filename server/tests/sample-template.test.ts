import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatementAmount, parseStatementCsv } from "@/server/modules/ingest/parse";

/**
 * The sample the upload modal offers has to be a file this parser accepts.
 *
 * It is handed to someone whose own export was just rejected, so "here is the
 * shape we want" is the entire value of it. A template that no longer parses
 * is worse than none: it teaches the wrong format and the person has no way to
 * tell. Pinning it here means a change to the parser that would break it fails
 * in CI rather than in front of a customer.
 *
 * It is deliberately a *realistic* export rather than a bare grid of columns:
 * a letterhead above the header row, `(AUD)` tags on the money columns, and a
 * closing-balance footer below the last transaction. Those are the three
 * shapes real bank exports arrive in and the parser learned to read, so the
 * sample doubles as their regression case — someone whose own statement opens
 * with a letterhead can see that it is expected rather than the reason their
 * upload was refused.
 */
const TEMPLATE = path.join(process.cwd(), "..", "public", "sample-bank-statement.csv");
const text = readFileSync(TEMPLATE, "utf8");

/**
 * A figure the letterhead states about itself, e.g. `Opening Balance,"12,480.00"`.
 * The letterhead sits above the transactions, so the first line carrying the
 * label is the summary one and not the closing-balance footer that repeats it.
 */
function statedBalance(label: string): number {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(label + ","));
  expect(line, "the letterhead states its " + label).toBeDefined();
  // parseCents sees through a thousands separator but not the CSV quoting.
  const cents = parseStatementAmount(line!.slice(label.length + 1).replace(/"/g, ""));
  expect(cents, label + " reads as money").not.toBeNull();
  return cents!;
}

describe("the sample statement offered in the upload modal", () => {
  const result = parseStatementCsv(text);

  it("parses with nothing rejected", () => {
    expect(result.failed).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("shows both directions, so the sign convention is visible", () => {
    expect(result.rows.some((r) => r.amountCents > 0)).toBe(true);
    expect(result.rows.some((r) => r.amountCents < 0)).toBe(true);
  });

  it("keeps money in integer cents", () => {
    for (const row of result.rows) expect(Number.isInteger(row.amountCents)).toBe(true);
  });

  it("carries no real client data", () => {
    expect(text).not.toMatch(/\b\d{6,}\b/); // no account or BSB-looking numbers
  });

  /* The three shapes of a real export, which this file exists to demonstrate. */

  it("skips the letterhead rather than reporting it as unreadable", () => {
    // Skipped rows are the bank's preamble and the closing footer. Were the
    // header row missed, the file would fall back to positional columns and
    // read the description out of the amount column.
    expect(result.skipped ?? 0).toBeGreaterThan(0);
    expect(result.columns.positional).toBeFalsy();
  });

  it("finds the money columns through their currency tags", () => {
    // `Amount (AUD)` names the unit, not the column. The map keeps the
    // original spelling, because that is what the row lookup matches.
    expect(result.columns.amount).toMatch(/\(AUD\)/);
    expect(result.columns.balance).toMatch(/\(AUD\)/);
    expect(result.columns.debit).toBeUndefined();
    expect(result.columns.credit).toBeUndefined();
  });

  it("is dated across one Australian BAS quarter, day before month", () => {
    // 02/07/2026 is 2 July, not 7 February. Read the American way the dates
    // would still be valid, so the months are asserted rather than the count.
    const months = [...new Set(result.rows.map((r) => r.date.getUTCMonth()))].sort((a, b) => a - b);
    expect(months).toEqual([6, 7, 8]); // Jul, Aug, Sep — Q1 of FY2027
    for (const row of result.rows) expect(row.date.getUTCFullYear()).toBe(2026);
  });

  /*
    An accountant reads the balance column before anything else, and a sample
    whose arithmetic does not hold teaches that ours does not either. The
    letterhead's own opening and closing figures are included: they are prose
    to the parser, so nothing else would catch them drifting.
  */
  it("reconciles: every balance is the one before it plus the amount", () => {
    let running = statedBalance("Opening Balance");
    for (const row of result.rows) {
      expect(row.balanceCents, "row " + row.index + " carries a balance").not.toBeNull();
      running += row.amountCents;
      expect(row.balanceCents, "row " + row.index + " " + row.description).toBe(running);
    }
    expect(running).toBe(statedBalance("Closing Balance"));
  });
});

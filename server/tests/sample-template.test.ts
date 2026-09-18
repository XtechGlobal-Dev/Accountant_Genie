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
 * a letterhead above the header row, a `Reference` column beside the
 * description that most rows leave empty, and a closing-balance footer below
 * the last transaction. Those are the shapes real bank exports arrive in and
 * the parser learned to read, so the sample doubles as their regression case —
 * someone whose own statement opens with a letterhead can see that it is
 * expected rather than the reason their upload was refused.
 *
 * The thirty transactions are one September of a small Australian business:
 * customer payments, subscriptions, rent, wages, a loan repayment with its
 * interest on its own line, an ATO payment — every tier of the coding engine
 * has something to do with it.
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

  it("codes from the description, not the reference column beside it", () => {
    // A `Reference` column is noise to the rules, the memory and the model
    // alike; it names the narration only when nothing better does.
    expect(result.columns.description).toBe("Description");
    expect(result.columns.amount).toBe("Amount");
    expect(result.columns.balance).toBe("Balance");
    expect(result.columns.debit).toBeUndefined();
    expect(result.columns.credit).toBeUndefined();
    expect(result.rows[0]?.description).toBe("OFFICEWORKS - STATIONERY");
  });

  it("carries the thirty transactions, and the opening balance is not one of them", () => {
    // An "OPENING BALANCE" row with a date and an amount would import as a
    // $12,000 receipt. The figure belongs in the letterhead, where the parser
    // skips it and the balance column still reconciles from it.
    expect(result.rows).toHaveLength(30);
    expect(result.rows.some((r) => /opening balance/i.test(r.description))).toBe(false);
  });

  it("is dated through one September, day before month", () => {
    // 12/09/2026 is 12 September, not 9 December. Read the American way most
    // of the dates would still be valid, so the month is asserted, not the count.
    for (const row of result.rows) {
      expect(row.date.getUTCFullYear()).toBe(2026);
      expect(row.date.getUTCMonth()).toBe(8); // September — Q1 of FY2027
    }
    expect(result.rows[0]?.date.getUTCDate()).toBe(2);
    expect(result.rows.at(-1)?.date.getUTCDate()).toBe(30);
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

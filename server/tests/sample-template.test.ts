import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatementCsv } from "@/server/modules/ingest/parse";

/**
 * The sample the upload modal offers has to be a file this parser accepts.
 *
 * It is handed to someone whose own export was just rejected, so "here is the
 * shape we want" is the entire value of it. A template that no longer parses
 * is worse than none: it teaches the wrong format and the person has no way to
 * tell. Pinning it here means a change to the parser that would break it fails
 * in CI rather than in front of a customer.
 */
const TEMPLATE = path.join(process.cwd(), "..", "public", "sample-bank-statement.csv");

describe("the sample statement offered in the upload modal", () => {
  const result = parseStatementCsv(readFileSync(TEMPLATE, "utf8"));

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
    const text = readFileSync(TEMPLATE, "utf8");
    expect(text).not.toMatch(/\b\d{6,}\b/); // no account or BSB-looking numbers
  });
});

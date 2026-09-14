import { describe, expect, it } from "vitest";
import { parseStatementPdfText } from "./parse-pdf";

const STATEMENT = `
Business Transaction Account
Statement period 1 July 2026 to 31 July 2026
Date Transaction Debit Credit Balance
01/07/2026 OPENING BALANCE 51,300.00
02/07/2026 PROGRESS CLAIM 2039 KELLYVILLE 8,800.00 60,100.00
03/07/2026 VISA PURCHASE BUNNINGS 6421 ALEXANDRIA 412.35 59,687.65
CARD 4523
07/07/2026 ACCOUNT KEEPING FEE 15.00 59,672.65
31/07/2026 CLOSING BALANCE 59,672.65
`;

describe("parseStatementPdfText", () => {
  it("reads dated lines and takes direction from the running balance", () => {
    const result = parseStatementPdfText(STATEMENT);
    expect(result.failed).toEqual([]);
    expect(result.rows.map((r) => r.amountCents)).toEqual([880_000, -41_235, -1_500]);
    expect(result.rows[1]?.balanceCents).toBe(5_968_765);
  });

  it("folds continuation lines into the previous description", () => {
    const result = parseStatementPdfText(STATEMENT);
    expect(result.rows[1]?.description).toBe("VISA PURCHASE BUNNINGS 6421 ALEXANDRIA CARD 4523");
    expect(result.rows[1]?.normalised).toBe("bunnings alexandria");
  });

  it("honours an explicit sign or DR/CR suffix without a balance", () => {
    const result = parseStatementPdfText("05/07/2026 RENT -3,300.00\n06/07/2026 SALES 110.00 CR\n07/07/2026 FEE 15.00 DR");
    expect(result.rows.map((r) => r.amountCents)).toEqual([-330_000, 11_000, -1_500]);
  });

  it("reports dated lines without an amount and refuses empty text", () => {
    const result = parseStatementPdfText("02/07/2026 SOMETHING WITHOUT NUMBERS");
    expect(result.rows).toEqual([]);
    expect(result.failed[0]?.reason).toMatch(/No amount/);
    expect(parseStatementPdfText("").failed[0]?.reason).toMatch(/scanned/);
  });
});

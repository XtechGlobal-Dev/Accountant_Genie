import type { GstTreatment } from "@/shared/enums";
import type { LedgerLine } from "./aggregate";

/**
 * Journals as other systems import them — pure, over ledger lines.
 *
 * Two formats, one source. Both list every line of every journal in the
 * period with the tax code translated to the target's vocabulary, and both
 * balance per journal because the ledger did. Column layouts follow each
 * vendor's published manual-journal import template; a firm's own template
 * may differ in column order, which is an edit to this file, not the ledger.
 *
 * Money leaves as dollars with two decimals because that is what the target
 * expects; it is formatted from cents at this edge only.
 */

const dollars = (cents: number) => (cents / 100).toFixed(2);
const dateAu = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

/** A text cell: quoted when needed, and guarded against spreadsheet formula injection. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** A number cell is never guarded — a leading minus is the sign, not a formula. */
function csvNumber(value: string): string {
  return value;
}

/* -------------------------------------------------------------------------- */
/* Xero — manual journal CSV                                                  */
/* -------------------------------------------------------------------------- */

/** Xero's default Australian tax rate names. */
const XERO_TAX: Record<GstTreatment, string> = {
  GST_ON_INCOME: "GST on Income",
  GST_FREE_INCOME: "GST Free Income",
  GST_ON_EXPENSES: "GST on Expenses",
  GST_FREE_EXPENSES: "GST Free Expenses",
  GST_ON_CAPITAL: "GST on Capital",
  GST_FREE_CAPITAL: "GST Free Capital",
  INPUT_TAXED: "Input Taxed",
  BAS_EXCLUDED: "BAS Excluded",
  UNALLOCATED: "BAS Excluded",
};

export function journalsToXeroCsv(lines: readonly LedgerLine[]): string {
  const header = ["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount", "TrackingName1", "TrackingOption1"];
  const rows = [header.map(csvCell).join(",")];
  for (const line of sortForExport(lines)) {
    // Xero manual journals take one signed amount per line: debits positive, credits negative.
    const amount = line.debitCents - line.creditCents;
    const cells = [
      line.entryDescription ?? `Journal ${line.entryId}`,
      dateAu(line.date),
      line.lineDescription ?? "",
      String(line.accountCode),
      XERO_TAX[line.gstTreatment ?? "BAS_EXCLUDED"],
    ].map(csvCell);
    rows.push([...cells, csvNumber(dollars(amount)), "", ""].join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

/* -------------------------------------------------------------------------- */
/* MYOB — general journal import (tab-delimited)                              */
/* -------------------------------------------------------------------------- */

/** MYOB AccountRight tax codes. */
const MYOB_TAX: Record<GstTreatment, string> = {
  GST_ON_INCOME: "GST",
  GST_FREE_INCOME: "FRE",
  GST_ON_EXPENSES: "GST",
  GST_FREE_EXPENSES: "FRE",
  GST_ON_CAPITAL: "CAP",
  GST_FREE_CAPITAL: "FRE",
  INPUT_TAXED: "INP",
  BAS_EXCLUDED: "N-T",
  UNALLOCATED: "N-T",
};

export function journalsToMyobTxt(lines: readonly LedgerLine[]): string {
  const header = ["Journal Number", "Date", "Memo", "Inclusive", "Account Number", "Debit Amount", "Credit Amount", "Job", "Allocation Memo", "Tax Code"];
  const rows = [header.join("\t")];
  const numbers = new Map<string, number>();
  for (const line of sortForExport(lines)) {
    let number = numbers.get(line.entryId);
    if (number === undefined) {
      number = numbers.size + 1;
      numbers.set(line.entryId, number);
    }
    rows.push(
      [
        `GJ${String(number).padStart(6, "0")}`,
        dateAu(line.date),
        (line.entryDescription ?? "").replace(/\t|\r|\n/g, " "),
        "Y",
        String(line.accountCode),
        line.debitCents > 0 ? dollars(line.debitCents) : "",
        line.creditCents > 0 ? dollars(line.creditCents) : "",
        "",
        (line.lineDescription ?? "").replace(/\t|\r|\n/g, " "),
        MYOB_TAX[line.gstTreatment ?? "BAS_EXCLUDED"],
      ].join("\t"),
    );
  }
  return rows.join("\r\n") + "\r\n";
}

function sortForExport(lines: readonly LedgerLine[]): LedgerLine[] {
  return [...lines].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.entryId.localeCompare(b.entryId) || b.debitCents - a.debitCents,
  );
}

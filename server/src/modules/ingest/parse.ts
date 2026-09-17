import Papa from "papaparse";
import { parseCents } from "@/shared/money";

/**
 * CSV bank statements into a canonical row shape.
 *
 * Every Australian bank exports something different: some with a header row,
 * some without; some with one signed amount column, some with debit and
 * credit columns; dates as 12/08/2026, 2026-08-12 or 12 Aug 2026. This file
 * recognises the common shapes and refuses, row by row, what it cannot read.
 * A row it cannot read is reported with its reason; the rest still import.
 *
 * Pure: no I/O, so every format decision is unit-tested.
 */

export interface ColumnMap {
  date: string;
  description: string;
  /** A single signed amount column… */
  amount?: string | undefined;
  /** …or separate debit and credit columns. */
  debit?: string | undefined;
  credit?: string | undefined;
  balance?: string | undefined;
  /** True when the file had no header row and columns were taken by position. */
  positional?: boolean | undefined;
}

export interface ParsedRow {
  /** Zero-based index in the file, for error messages. */
  index: number;
  date: Date;
  description: string;
  normalised: string;
  amountCents: number;
  balanceCents: number | null;
}

export interface FailedRow {
  index: number;
  reason: string;
  raw: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  failed: FailedRow[];
  columns: ColumnMap;
  /**
   * Rows that were never transactions: the bank's preamble above the header
   * (account holder, statement period, opening balance) and the notes below
   * the last line. Skipped silently rather than reported as unreadable, so a
   * statement with a letterhead does not look like a statement with errors.
   */
  skipped?: number | undefined;
}

/* -------------------------------------------------------------------------- */
/* Column detection                                                           */
/* -------------------------------------------------------------------------- */

const HEADER_HINTS: Record<keyof Omit<ColumnMap, "positional">, RegExp> = {
  date: /^(date|transaction date|txn date|posted|posted date|value date|effective date)$/i,
  description:
    /^(description|transaction description|description of transaction|narrative|transaction narrative|narration|details|transaction details|memo|particulars)$/i,
  amount: /^(amount|transaction amount|value)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|dr)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|cr)$/i,
  balance: /^(balance|running balance|closing balance)$/i,
};

/**
 * Headers that name the narration only when nothing better does. A statement
 * that carries both a "Reference" (EFT-0902) and a "Transaction description"
 * must code from the description: the reference is noise to the rules, the
 * memory and the model alike.
 */
const DESCRIPTION_FALLBACK = /^(payee|reference|transaction reference)$/i;

/**
 * A header as the hints see it: case folded; `money_in`, `Money-In` and
 * `running.balance` read as the words they are; and a currency tag —
 * `Amount (AUD)`, `Balance AUD`, `Amount $` — dropped, since it names the
 * unit, not the column. Exports written by software rather than by a bank
 * do all three; the hints stay in plain words and the header is brought to
 * them. The original spelling is what the column map keeps, because that is
 * what the row lookup matches.
 */
function headerWords(header: string): string {
  return header
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+(aud|nzd|usd|\$|a\$)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map headers to fields, or null when the essentials cannot be found. */
export function detectColumns(headers: readonly string[]): ColumnMap | null {
  const clean = headers.map((h) => h.trim());
  const find = (key: keyof typeof HEADER_HINTS) =>
    clean.find((h) => HEADER_HINTS[key].test(headerWords(h)));

  const date = find("date");
  const description = find("description") ?? clean.find((h) => DESCRIPTION_FALLBACK.test(headerWords(h)));
  const amount = find("amount");
  const debit = find("debit");
  const credit = find("credit");
  const balance = find("balance");

  if (!date || !description) return null;
  if (!amount && !(debit || credit)) return null;

  return { date, description, amount, debit, credit, balance };
}

/* -------------------------------------------------------------------------- */
/* Field parsing                                                              */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function utcDate(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d;
  return valid ? date : null;
}

/**
 * Australian statement dates. Day comes before month: 03/07/2026 is 3 July.
 * ISO `2026-07-03` and `3 Jul 2026` are accepted too. Two-digit years are
 * read as 20xx.
 */
export function parseStatementDate(input: string): Date | null {
  const s = input.trim();
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) {
    return utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s))) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return utcDate(year, Number(m[2]) - 1, Number(m[1]));
  }
  if ((m = /^(\d{1,2})[ -]([A-Za-z]{3,4})[ -](\d{2,4})$/.exec(s))) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month === undefined) return null;
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return utcDate(year, month, Number(m[1]));
  }
  return null;
}

/** A statement amount in cents, or null. Blank is null, not zero. */
export function parseStatementAmount(input: string | undefined): number | null {
  if (input === undefined) return null;
  const s = input.trim();
  if (s === "") return null;
  // "12.00 DR" / "12.00 CR" suffixes on some exports.
  const suffix = /^(.*?)\s*(DR|CR)$/i.exec(s);
  if (suffix) {
    const cents = parseCents(suffix[1]!);
    if (cents === null) return null;
    return suffix[2]!.toUpperCase() === "DR" ? -Math.abs(cents) : Math.abs(cents);
  }
  return parseCents(s);
}

/**
 * The description as rules and memory see it: lower-cased, with the noise a
 * bank appends stripped — card suffixes, receipt numbers, dates, "VISA
 * PURCHASE" boilerplate — so the same merchant reads the same way every time.
 */
export function normaliseDescription(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(visa|mastercard|eftpos|debit card|credit card|card)\s+(purchase|payment|debit)\b/g, " ")
    .replace(/\b(purchase|payment|debit|credit|deposit)\s+(at|to|from)\b/g, " ")
    .replace(/\bcard\s*(x|\*)*\d{2,}\b/g, " ")
    .replace(/\b(ref|receipt|rcpt|auth|trace)\b[:#]?\s*\w+/g, " ")
    .replace(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9&'.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* The file                                                                   */
/* -------------------------------------------------------------------------- */

const POSITIONAL: ColumnMap = {
  date: "0",
  amount: "1",
  description: "2",
  balance: "3",
  positional: true,
};

function looksLikeDate(value: string | undefined): boolean {
  return value !== undefined && parseStatementDate(value) !== null;
}

/** How far down a file the header row may sit below the bank's letterhead. */
const HEADER_SEARCH_ROWS = 50;

/**
 * Parse a statement. With no `columns`, the header row is detected; a file
 * whose first row already holds a date is read positionally as
 * date, amount, description, balance — the common headerless export.
 *
 * Many exports open with a letterhead — bank name, account holder, statement
 * period, an opening/closing balance summary — before the real header row.
 * The header is the first row whose cells name the essentials, searched
 * within the first fifty rows; everything above it is skipped. Rows below
 * the last transaction that carry neither a date nor an amount (a
 * reconciliation note, a page footer) are skipped the same way. A row with
 * an amount but no readable date is still a failure: that is a transaction
 * the file could not describe, not decoration.
 */
export function parseStatementCsv(text: string, columns?: ColumnMap): ParseResult {
  const content = text.replace(/^﻿/, "");
  const raw = Papa.parse<string[]>(content, { skipEmptyLines: "greedy" });
  const table = raw.data.filter((row) => row.some((cell) => cell.trim() !== ""));

  if (table.length === 0) return { rows: [], failed: [], columns: columns ?? POSITIONAL };

  let map = columns;
  let body = table;
  let headers: string[] | null = null;
  let headerRow = 0;
  let skipped = 0;

  if (!map) {
    if (looksLikeDate(table[0]?.[0])) {
      map = POSITIONAL;
    } else {
      const limit = Math.min(table.length, HEADER_SEARCH_ROWS);
      for (let i = 0; i < limit; i++) {
        const candidate = detectColumns(table[i] ?? []);
        if (candidate) {
          map = candidate;
          headers = table[i] ?? [];
          headerRow = i;
          break;
        }
      }
      skipped = headerRow;
      body = table.slice(headerRow + 1);
    }
  } else if (!map.positional) {
    headers = table[0] ?? [];
    body = table.slice(1);
  }

  if (!map) {
    return {
      rows: [],
      failed: [
        {
          index: 0,
          reason:
            "Could not find a header row naming the date, description and amount columns in the first 50 lines",
          raw: (table[0] ?? []).join(","),
        },
      ],
      columns: { date: "", description: "" },
    };
  }

  const columnIndex = (name: string | undefined): number | null => {
    if (name === undefined || name === "") return null;
    if (map!.positional) return Number(name);
    const i = headers!.findIndex((h) => h.trim() === name);
    return i === -1 ? null : i;
  };

  const idx = {
    date: columnIndex(map.date),
    description: columnIndex(map.description),
    amount: columnIndex(map.amount),
    debit: columnIndex(map.debit),
    credit: columnIndex(map.credit),
    balance: columnIndex(map.balance),
  };

  const rows: ParsedRow[] = [];
  const failed: FailedRow[] = [];
  const offset = headers ? headerRow + 1 : 0;

  body.forEach((cells, i) => {
    const index = i + offset;
    const cell = (at: number | null) => (at === null ? undefined : cells[at]);

    const date = parseStatementDate(cell(idx.date) ?? "");
    if (!date) {
      // No date and no amount anywhere an amount could be: a note or a
      // footer, not a transaction the file failed to describe.
      const anyAmount = [idx.amount, idx.debit, idx.credit].some((at) => parseStatementAmount(cell(at)) !== null);
      if (!anyAmount) {
        skipped += 1;
        return;
      }
      failed.push({ index, reason: `Unreadable date "${cell(idx.date) ?? ""}"`, raw: cells.join(",") });
      return;
    }

    const description = (cell(idx.description) ?? "").trim();
    if (!description) {
      failed.push({ index, reason: "Empty description", raw: cells.join(",") });
      return;
    }

    let amountCents: number | null = null;
    if (idx.amount !== null) {
      amountCents = parseStatementAmount(cell(idx.amount));
    } else {
      const debit = parseStatementAmount(cell(idx.debit));
      const credit = parseStatementAmount(cell(idx.credit));
      if (debit === null && credit === null) {
        amountCents = null;
      } else {
        amountCents = (credit ?? 0) - Math.abs(debit ?? 0);
      }
    }
    if (amountCents === null) {
      failed.push({ index, reason: "Unreadable amount", raw: cells.join(",") });
      return;
    }

    const balanceRaw = cell(idx.balance);
    const balanceCents = balanceRaw === undefined ? null : parseStatementAmount(balanceRaw);

    rows.push({
      index,
      date,
      description,
      normalised: normaliseDescription(description),
      amountCents,
      balanceCents,
    });
  });

  return { rows, failed, columns: map, skipped };
}

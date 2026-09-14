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
}

/* -------------------------------------------------------------------------- */
/* Column detection                                                           */
/* -------------------------------------------------------------------------- */

const HEADER_HINTS: Record<keyof Omit<ColumnMap, "positional">, RegExp> = {
  date: /^(date|transaction date|txn date|posted|value date|effective date)$/i,
  description: /^(description|narrative|details|memo|particulars|transaction details|payee|reference)$/i,
  amount: /^(amount|transaction amount|value)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|dr)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|cr)$/i,
  balance: /^(balance|running balance|closing balance)$/i,
};

/** Map headers to fields, or null when the essentials cannot be found. */
export function detectColumns(headers: readonly string[]): ColumnMap | null {
  const clean = headers.map((h) => h.trim());
  const find = (key: keyof typeof HEADER_HINTS) =>
    clean.find((h) => HEADER_HINTS[key].test(h));

  const date = find("date");
  const description = find("description");
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

/**
 * Parse a statement. With no `columns`, the header row is detected; a file
 * whose first row already holds a date is read positionally as
 * date, amount, description, balance — the common headerless export.
 */
export function parseStatementCsv(text: string, columns?: ColumnMap): ParseResult {
  const content = text.replace(/^﻿/, "");
  const raw = Papa.parse<string[]>(content, { skipEmptyLines: "greedy" });
  const table = raw.data.filter((row) => row.some((cell) => cell.trim() !== ""));

  if (table.length === 0) return { rows: [], failed: [], columns: columns ?? POSITIONAL };

  let map = columns;
  let body = table;
  let headers: string[] | null = null;

  if (!map) {
    if (looksLikeDate(table[0]?.[0])) {
      map = POSITIONAL;
    } else {
      headers = table[0] ?? [];
      map = detectColumns(headers) ?? undefined;
      body = table.slice(1);
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
          reason: "Could not find date, description and amount columns in the header row",
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
  const offset = headers ? 1 : 0;

  body.forEach((cells, i) => {
    const index = i + offset;
    const cell = (at: number | null) => (at === null ? undefined : cells[at]);

    const date = parseStatementDate(cell(idx.date) ?? "");
    if (!date) {
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

  return { rows, failed, columns: map };
}

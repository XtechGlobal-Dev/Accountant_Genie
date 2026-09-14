"use client";

/**
 * What a person does with a finished report: print it (or save it as PDF
 * through the print dialog) and download the table as CSV.
 *
 * The CSV is built from the rendered table, so it is exactly what is on
 * screen — the same figures, the same period, the same rounding — and no
 * report needs its own export code. Formula-looking cells are guarded.
 */

import { Button } from "@/ui/primitives";

function csvCell(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const guarded = /^[=+\-@\t\r]/.test(trimmed) && !/^[-−]?\$?[\d,]+(\.\d+)?$/.test(trimmed) ? `'${trimmed}` : trimmed;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function tableToCsv(table: HTMLTableElement): string {
  const rows: string[] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((cell) => {
      const text = (cell as HTMLElement).innerText ?? cell.textContent ?? "";
      // Amounts are shown with a typographic minus; the CSV gets a plain one.
      return csvCell(text.replace(/−/g, "-").replace(/\$/g, ""));
    });
    if (cells.some((cell) => cell !== "")) rows.push(cells.join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

export function ReportActions({ filename }: { filename: string }) {
  function download() {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>("main table"));
    if (tables.length === 0) return;
    const csv = tables.map(tableToCsv).join("\r\n");
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" icon="download" onClick={download}>
        CSV
      </Button>
      <Button variant="secondary" icon="printer" onClick={() => window.print()}>
        Print / PDF
      </Button>
    </span>
  );
}

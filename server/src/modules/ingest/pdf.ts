import "server-only";

/**
 * Text out of a PDF. Image-only (scanned) statements yield nothing here;
 * the parser then reports that plainly rather than guessing.
 *
 * `pdf-parse` is loaded inside the function, not at the top of the file, and
 * that placement is load-bearing.
 *
 * It wraps pdf.js, which reaches for browser globals — `DOMMatrix` among them —
 * while its module is being evaluated. A top-level import therefore runs that
 * code the moment anything in the import graph is pulled in, and the graph here
 * is wider than it looks: the Activity Panel lives in the app shell and imports
 * `ingest/actions`, so every signed-in page in the product was evaluating the
 * PDF parser. On a runtime without those globals that is a 500 on `/clients`,
 * `/memory`, `/accounts` — pages that never touch a PDF.
 *
 * Deferring it means the parser is evaluated when a PDF is actually read, and
 * nowhere else.
 */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

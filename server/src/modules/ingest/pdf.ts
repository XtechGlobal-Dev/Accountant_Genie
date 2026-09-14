import "server-only";

import { PDFParse } from "pdf-parse";

/**
 * Text out of a PDF. Image-only (scanned) statements yield nothing here;
 * the parser then reports that plainly rather than guessing.
 */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

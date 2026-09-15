/**
 * A client's logo: what may be uploaded, decided from the bytes.
 *
 * The browser's filename and Content-Type are not trusted — the first bytes
 * are. Only raster formats are accepted: an SVG is a document that can carry
 * script, and it would be served back to every user who opens the client.
 * See .claude/skills/tenant-security/SKILL.md, "File uploads".
 */

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export type LogoKind = { kind: "png" | "jpeg" | "webp"; contentType: string; ext: string };

export function sniffImage(bytes: Uint8Array): LogoKind | null {
  if (bytes.length < 12) return null;
  const b = (i: number) => bytes[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a) {
    return { kind: "png", contentType: "image/png", ext: "png" };
  }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return { kind: "jpeg", contentType: "image/jpeg", ext: "jpg" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { kind: "webp", contentType: "image/webp", ext: "webp" };
  }
  return null;
}

/** Why an upload was refused, in words the form can show. */
export function checkLogo(bytes: Uint8Array): { ok: true; kind: LogoKind } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "Choose an image to upload" };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: "The logo must be 2 MB or smaller" };
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: "The logo must be a PNG, JPEG or WebP image" };
  return { ok: true, kind };
}

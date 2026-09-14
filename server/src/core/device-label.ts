/**
 * A name for a browser, for the trusted-device list — "Chrome on Windows".
 *
 * Deliberately coarse, and deliberately free of any import: it exists so
 * someone recognises their own laptop in Settings, not to fingerprint them.
 * No version, no address, no stored agent string, and an agent we do not
 * recognise is simply "Unknown browser".
 *
 * Order matters. Every Chromium browser claims to be Chrome and Safari, and
 * Chrome claims to be Safari, so the more specific brand is tested first.
 */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown browser";
}

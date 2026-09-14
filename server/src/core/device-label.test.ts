import { describe, expect, it } from "vitest";
import { deviceLabel } from "./device-label";

/**
 * The label is what someone reads in Settings when deciding which browser to
 * stop trusting. Getting Edge or Chrome wrong there means forgetting the
 * wrong device — so the order the brands are tested in is the thing under
 * test, not the regexes themselves.
 */

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/140.0.0.0`;
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("deviceLabel", () => {
  it("names the common desktop browsers with their platform", () => {
    expect(deviceLabel(CHROME_WIN)).toBe("Chrome on Windows");
    expect(deviceLabel(SAFARI_MAC)).toBe("Safari on macOS");
    expect(deviceLabel(FIREFOX_LINUX)).toBe("Firefox on Linux");
  });

  it("does not mistake Edge for Chrome, which its agent also claims to be", () => {
    expect(deviceLabel(EDGE_WIN)).toBe("Edge on Windows");
  });

  it("does not mistake Chrome for Safari, which its agent also claims to be", () => {
    expect(deviceLabel(CHROME_WIN)).not.toContain("Safari");
  });

  it("prefers the phone's platform over the Linux kernel Android reports", () => {
    expect(deviceLabel(CHROME_ANDROID)).toBe("Chrome on Android");
    expect(deviceLabel(SAFARI_IOS)).toBe("Safari on iOS");
  });

  it("says something usable when the agent is missing or unknown", () => {
    expect(deviceLabel(null)).toBe("Unknown browser");
    expect(deviceLabel("")).toBe("Unknown browser");
    expect(deviceLabel("curl/8.4.0")).toBe("Unknown browser");
  });

  it("never echoes the agent string back, which would put a fingerprint on screen", () => {
    expect(deviceLabel(CHROME_WIN)).not.toContain("537.36");
    expect(deviceLabel(EDGE_WIN).length).toBeLessThan(40);
  });
});

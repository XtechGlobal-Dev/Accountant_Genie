import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, checkLogo, sniffImage } from "./logo";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = new Uint8Array([...("RIFF".split("").map((c) => c.charCodeAt(0))), 0, 0, 0, 0, ...("WEBP".split("").map((c) => c.charCodeAt(0))), 0, 0]);

describe("sniffImage", () => {
  it("recognises PNG, JPEG and WebP from their first bytes", () => {
    expect(sniffImage(png)?.kind).toBe("png");
    expect(sniffImage(jpeg)?.kind).toBe("jpeg");
    expect(sniffImage(webp)?.kind).toBe("webp");
  });

  it("refuses anything else, including an SVG whatever its filename says", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("checkLogo", () => {
  it("accepts a small PNG and refuses an empty or oversized file", () => {
    expect(checkLogo(png)).toMatchObject({ ok: true });
    expect(checkLogo(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toMatchObject({ ok: false, error: expect.stringMatching(/2 MB/) });
  });
});

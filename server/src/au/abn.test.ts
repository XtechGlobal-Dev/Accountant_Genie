import { describe, expect, it } from "vitest";
import { formatAbn, isValidAbn, normaliseAbn } from "./abn";

/**
 * Real ABNs, from public entities. The checksum is the point: every one of the
 * rejections below passes an "eleven digits" test.
 */
const VALID = [
  "51824753556", // CSIRO
  "53004085616", // Telstra
  "11005357522", // ANZ
  "48123123124", // ATO's own published example
];

describe("isValidAbn", () => {
  it("accepts real ABNs", () => {
    for (const abn of VALID) expect(isValidAbn(abn), abn).toBe(true);
  });

  it("accepts the spaced and hyphenated forms people paste", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true);
    expect(isValidAbn("51-824-753-556")).toBe(true);
    expect(isValidAbn("  51824753556  ")).toBe(true);
  });

  it("rejects eleven digits that are not an ABN", () => {
    // The whole reason this module exists — each of these is 11 digits.
    expect(isValidAbn("11111111111")).toBe(false);
    expect(isValidAbn("00000000000")).toBe(false);
    expect(isValidAbn("12345678901")).toBe(false);
  });

  it("catches a single mistyped digit", () => {
    // The realistic failure: someone transcribes an ABN off an invoice.
    expect(isValidAbn("51824753556")).toBe(true);
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("51824753656")).toBe(false);
    expect(isValidAbn("52824753556")).toBe(false);
  });

  it("catches a transposition", () => {
    expect(isValidAbn("51824753565")).toBe(false);
    expect(isValidAbn("51284753556")).toBe(false);
  });

  it("rejects the wrong length, letters and empty input", () => {
    expect(isValidAbn("")).toBe(false);
    expect(isValidAbn("5182475355")).toBe(false); // 10
    expect(isValidAbn("518247535561")).toBe(false); // 12
    expect(isValidAbn("5182475355A")).toBe(false);
    // A TFN is 9 digits and gets confused with an ABN. It is not one.
    expect(isValidAbn("123456782")).toBe(false);
  });

  it("rejects an ABN starting with 0, which cannot exist", () => {
    // Decrementing the first digit would go negative.
    expect(isValidAbn("01824753556")).toBe(false);
  });
});

describe("formatAbn", () => {
  it("groups the way the ATO prints it", () => {
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
    expect(formatAbn("51 824 753 556")).toBe("51 824 753 556");
  });

  it("leaves anything that is not eleven digits alone", () => {
    expect(formatAbn("not an abn")).toBe("not an abn");
  });
});

describe("normaliseAbn", () => {
  it("strips spaces and hyphens only", () => {
    expect(normaliseAbn("51 824-753 556")).toBe("51824753556");
  });
});

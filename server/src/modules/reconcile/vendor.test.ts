import { describe, expect, it } from "vitest";
import { vendorKey } from "./vendor";

describe("vendorKey", () => {
  it("collapses the ways a bank names one supplier onto one key", () => {
    expect(vendorKey("adobe")).toBe("adobe");
    expect(vendorKey("adobe australia")).toBe("adobe");
    expect(vendorKey("adobe australia pty ltd")).toBe("adobe");
    expect(vendorKey("adobe creative cloud")).toBe("adobe");
    expect(vendorKey("canva pro annual subscription")).toBe("canva");
    expect(vendorKey("officeworks auburn")).toBe("officeworks");
    expect(vendorKey("telstra bill payment")).toBe("telstra");
    expect(vendorKey("energyaustralia")).toBe("energyaustralia");
  });

  it("keeps a second token when the first alone names nothing", () => {
    expect(vendorKey("property group pty ltd")).toBe("property group");
    expect(vendorKey("abc payroll")).toBe("abc payroll");
    expect(vendorKey("the iconic")).toBe("iconic");
  });

  it("is null when the narration names no supplier", () => {
    expect(vendorKey("")).toBeNull();
    expect(vendorKey("1234 5678")).toBeNull();
    expect(vendorKey("payment")).toBeNull();
    expect(vendorKey("bp")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { CustomAccountSchema, customAccountFromForm } from "./schema";

const base = {
  name: "Software Subscriptions",
  code: 1500,
  type: "EXPENSE",
  gstTreatment: "GST_ON_EXPENSES",
  description: "",
  clientId: "",
};

describe("CustomAccountSchema", () => {
  it("accepts a well-formed custom expense account", () => {
    expect(CustomAccountSchema.safeParse(base).success).toBe(true);
  });

  it("reserves codes below 1000 for system accounts", () => {
    const result = CustomAccountSchema.safeParse({ ...base, code: 450 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["code"]);
  });

  it("caps codes at 9999 and requires whole numbers", () => {
    expect(CustomAccountSchema.safeParse({ ...base, code: 10000 }).success).toBe(false);
    expect(CustomAccountSchema.safeParse({ ...base, code: 1500.5 }).success).toBe(false);
  });

  it("refuses a tax code that does not belong on the account type", () => {
    const result = CustomAccountSchema.safeParse({
      ...base,
      type: "INCOME",
      gstTreatment: "GST_ON_EXPENSES",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["gstTreatment"]);
  });

  it("only ever allows BAS Excluded on liabilities and equity", () => {
    expect(
      CustomAccountSchema.safeParse({ ...base, type: "LIABILITY", gstTreatment: "GST_ON_EXPENSES" })
        .success,
    ).toBe(false);
    expect(
      CustomAccountSchema.safeParse({ ...base, type: "EQUITY", gstTreatment: "BAS_EXCLUDED" })
        .success,
    ).toBe(true);
  });

  it("cannot express a sentinel account or an unallocated treatment", () => {
    expect(CustomAccountSchema.safeParse({ ...base, type: "UNKNOWN" }).success).toBe(false);
    expect(
      CustomAccountSchema.safeParse({ ...base, gstTreatment: "UNALLOCATED" }).success,
    ).toBe(false);
  });
});

describe("customAccountFromForm", () => {
  it("reads the form and coerces the code", () => {
    const form = new FormData();
    form.set("name", "Drone Hire");
    form.set("code", "2100");
    form.set("type", "INCOME");
    form.set("gstTreatment", "GST_ON_INCOME");
    const result = customAccountFromForm(form);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe(2100);
      expect(result.data.clientId).toBe("");
    }
  });
});

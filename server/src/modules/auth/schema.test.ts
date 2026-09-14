import { describe, expect, it } from "vitest";
import { fromForm } from "./schema";

/**
 * Sign-up carries one rule that is not cosmetic: claiming to be a registered
 * practitioner is what grants the right to verify a tax rule, so the claim
 * cannot be accepted without the body and number that evidence it.
 */

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const base = {
  firmName: "Meridian Accounting",
  name: "Jane Ledger",
  email: "jane@meridian.test",
  password: "a-long-enough-password",
  state: "NSW",
  isTaxAgent: "no",
};

describe("sign-up", () => {
  it("accepts the minimum a practice needs to start", () => {
    const parsed = fromForm.signUp(form(base));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.state).toBe("NSW");
    expect(parsed.data.isTaxAgent).toBe(false);
    // Untouched optional fields are absent, never empty strings in the column.
    expect(parsed.data.phone).toBeUndefined();
    expect(parsed.data.professionalTitle).toBeUndefined();
    expect(parsed.data.howHeard).toBeUndefined();
  });

  it("requires the state, because obligations differ by it", () => {
    const { state: _omitted, ...withoutState } = base;
    const parsed = fromForm.signUp(form(withoutState));
    expect(parsed.success).toBe(false);
  });

  it("rejects a state that is not an Australian one", () => {
    expect(fromForm.signUp(form({ ...base, state: "CA" })).success).toBe(false);
  });

  it("refuses a registration claim with no body and no number", () => {
    const parsed = fromForm.signUp(form({ ...base, isTaxAgent: "yes" }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((i) => String(i.path[0]));
    expect(paths).toContain("professionalBody");
    expect(paths).toContain("agentNumber");
  });

  it("refuses a claim with a body but no number", () => {
    const parsed = fromForm.signUp(
      form({ ...base, isTaxAgent: "yes", professionalBody: "CPA_AUSTRALIA" }),
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => String(i.path[0]))).toContain("agentNumber");
  });

  it("accepts a complete registration claim", () => {
    const parsed = fromForm.signUp(
      form({
        ...base,
        isTaxAgent: "yes",
        professionalBody: "CA_ANZ",
        agentNumber: "25123456",
        professionalTitle: "Principal",
        phone: "0400 000 000",
        howHeard: "FRIENDS_AND_COLLEAGUES",
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.isTaxAgent).toBe(true);
    expect(parsed.data.professionalBody).toBe("CA_ANZ");
    expect(parsed.data.agentNumber).toBe("25123456");
    // Spacing is stripped so two people typing the same number match.
    expect(parsed.data.phone).toBe("0400000000");
  });

  it("does not demand a body from someone who said no", () => {
    const parsed = fromForm.signUp(form({ ...base, isTaxAgent: "no" }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.professionalBody).toBeUndefined();
  });

  it("rejects an unknown accounting body", () => {
    expect(
      fromForm.signUp(form({ ...base, isTaxAgent: "yes", professionalBody: "MADE_UP", agentNumber: "1" }))
        .success,
    ).toBe(false);
  });

  it("rejects a phone number that is not one", () => {
    expect(fromForm.signUp(form({ ...base, phone: "call me" })).success).toBe(false);
  });

  it("still enforces the password length", () => {
    expect(fromForm.signUp(form({ ...base, password: "short" })).success).toBe(false);
  });
});

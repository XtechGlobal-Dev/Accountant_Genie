import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook";

/**
 * The webhook signature is the only thing standing between a public URL and
 * writes into a client's ledger, so the refusal cases matter more than the
 * acceptance case.
 *
 * Fiskil's docs disagree with themselves about the encoding — see the note in
 * webhook.ts — so we accept the two variants their own samples produce. These
 * tests pin exactly which two, and prove nothing else gets through.
 */

const SECRET_BYTES = Buffer.from("a-signing-secret-issued-by-the-console");
const SECRET_B64 = SECRET_BYTES.toString("base64");

function sign(body: Buffer | string, secret: Buffer = SECRET_BYTES): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

afterEach(() => {
  delete process.env.FISKIL_WEBHOOK_SECRET;
});

describe("verifyWebhook", () => {
  it("refuses every delivery when no secret is configured", () => {
    // Without a secret the sender cannot be authenticated at all. Refusing is
    // correct: trusting an unauthenticated payload that moves money into a
    // ledger is not an acceptable default.
    const body = Buffer.from('{"message_id":"m1"}');
    expect(verifyWebhook(body, sign(body))).toBe("unconfigured");
  });

  it("reports an empty secret as unconfigured, not as a bad signature", () => {
    process.env.FISKIL_WEBHOOK_SECRET = "   ";
    const body = Buffer.from('{"message_id":"m1"}');
    expect(verifyWebhook(body, sign(body))).toBe("unconfigured");
  });

  it("accepts a base64 digest over the base64-decoded secret", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    const body = Buffer.from('{"message_id":"m1","data":{"event":"consent.received"}}');
    expect(verifyWebhook(body, sign(body))).toBe("ok");
  });

  it("accepts the whitespace-stripped variant their OpenSSL sample produces", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    const body = Buffer.from('{\n  "message_id": "m1"\n}');
    const stripped = body.toString("utf8").replace(/[\n ]/g, "");
    expect(verifyWebhook(body, sign(stripped))).toBe("ok");
  });

  it("rejects a missing signature", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    expect(verifyWebhook(Buffer.from("{}"), null)).toBe("invalid");
    expect(verifyWebhook(Buffer.from("{}"), "")).toBe("invalid");
  });

  it("rejects a signature made with the wrong secret", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    const body = Buffer.from('{"message_id":"m1"}');
    expect(verifyWebhook(body, sign(body, Buffer.from("not-the-secret")))).toBe("invalid");
  });

  it("rejects a body altered after signing", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    const signature = sign(Buffer.from('{"message_id":"m1","amount":"1.00"}'));
    const tampered = Buffer.from('{"message_id":"m1","amount":"9999.00"}');
    expect(verifyWebhook(tampered, signature)).toBe("invalid");
  });

  it("rejects a hex digest, so the docs' TypeScript variant cannot slip through unnoticed", () => {
    // If a real delivery ever turns out to be hex, this test is the thing that
    // fails and tells us to change the scheme deliberately.
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    const body = Buffer.from('{"message_id":"m1"}');
    const hex = createHmac("sha256", SECRET_BYTES).update(body).digest("hex");
    expect(verifyWebhook(body, hex)).toBe("invalid");
  });

  it("does not throw on a signature of a different length", () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET_B64;
    expect(verifyWebhook(Buffer.from("{}"), "short")).toBe("invalid");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The transport's job when something goes wrong.
 *
 * A Resend key that is valid but whose sender may only reach the account
 * owner refuses every real recipient with a 403. That refusal used to arrive
 * as an unhandled throw with the provider's explanation discarded, so sign-up
 * died on a generic error and nothing in the log said why. Both halves of
 * that are what these tests hold in place: the reason is logged, and the
 * caller gets an outcome rather than an exception.
 *
 * `getMailer` caches its transport, so every case re-imports the module with
 * the environment it needs.
 */

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./mail");
}

const RESEND = { RESEND_API_KEY: "re_test_key", MAIL_FROM: "Test <no-reply@example.test>" };
const NO_PROVIDER = { RESEND_API_KEY: undefined, MAIL_FROM: undefined };
const MESSAGE = { to: "someone@example.test", subject: "Your code", text: "Your code is 123456." };

const original = {
  key: process.env.RESEND_API_KEY,
  from: process.env.MAIL_FROM,
  env: process.env.NODE_ENV,
  debug: process.env.MAIL_DEBUG_LOG_BODIES,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restore("RESEND_API_KEY", original.key);
  restore("MAIL_FROM", original.from);
  restore("NODE_ENV", original.env);
  restore("MAIL_DEBUG_LOG_BODIES", original.debug);
});

/** Whatever reached the log this test, across every level. */
function logged(): string {
  return [
    ...vi.mocked(console.error).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.info).mock.calls,
  ]
    .flat()
    .join(" ");
}

describe("deliver", () => {
  it("reports 'sent' when the provider accepts the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"abc"}', { status: 200 })));
    const { deliver } = await load(RESEND);
    await expect(deliver(MESSAGE)).resolves.toBe("sent");
  });

  it("reports 'logged' when no provider is configured", async () => {
    const { deliver } = await load(NO_PROVIDER);
    await expect(deliver(MESSAGE)).resolves.toBe("logged");
  });

  // The case that broke sign-up: the key is real, the sender is not allowed to
  // reach this recipient, and the 403 must not escape as an exception.
  it("reports 'failed' instead of throwing when the provider refuses", async () => {
    const refusal = JSON.stringify({
      statusCode: 403,
      name: "validation_error",
      message: "You can only send testing emails to your own email address.",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(refusal, { status: 403 })));
    const { deliver } = await load(RESEND);
    await expect(deliver(MESSAGE)).resolves.toBe("failed");
  });

  it("reports 'failed' when the provider cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { deliver } = await load(RESEND);
    await expect(deliver(MESSAGE)).resolves.toBe("failed");
  });

  // Without this line in the log, a configuration mistake is indistinguishable
  // from a bug — which is exactly how this one stayed hidden.
  it("logs the provider's own explanation alongside the refused message", async () => {
    const refusal = JSON.stringify({ statusCode: 403, message: "verify a domain at resend.com/domains" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(refusal, { status: 403 })));
    const { deliver } = await load(RESEND);
    await deliver(MESSAGE);

    // The diagnosis and the body are separate lines: the first says why, the
    // second is what the tester needs to carry on without the email.
    const reason = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(reason).toContain("403");
    expect(reason).toContain("verify a domain at resend.com/domains");
    expect(logged()).toContain("123456");
  });

  // Every message reaches the log while mail is being configured, not only the
  // ones that failed — a tester needs the code out of a successful send too.
  it("logs the body of a message the provider accepted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"abc"}', { status: 200 })));
    const { deliver } = await load(RESEND);
    await deliver(MESSAGE);
    expect(logged()).toContain("123456");
  });

  it("logs the body when no provider is configured", async () => {
    const { deliver } = await load(NO_PROVIDER);
    await deliver(MESSAGE);
    expect(logged()).toContain("123456");
  });
});

/**
 * The staging escape hatch. A sign-in code in a shared log is a credential
 * anyone with log access can use, so the production default has to stay
 * closed; the flag is the whole of the opt-in, and these two tests are what
 * stop it drifting open.
 */
describe("MAIL_DEBUG_LOG_BODIES", () => {
  const refusal = JSON.stringify({ statusCode: 403, message: "verify a domain" });

  function refuse() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(refusal, { status: 403 })));
  }

    it("withholds a refused message body in production by default", async () => {
    refuse();
    const { deliver } = await load({ ...RESEND, NODE_ENV: "production", MAIL_DEBUG_LOG_BODIES: undefined });
    await expect(deliver(MESSAGE)).resolves.toBe("failed");
    expect(logged()).not.toContain("123456");
  });

  it("prints a refused message body in production once it is set to 1", async () => {
    refuse();
    const { deliver } = await load({ ...RESEND, NODE_ENV: "production", MAIL_DEBUG_LOG_BODIES: "1" });
    await expect(deliver(MESSAGE)).resolves.toBe("failed");
    expect(logged()).toContain("123456");
  });

  // Any other value is not the opt-in. "true", "0" and "yes" all stay closed.
  it("treats any value other than 1 as off", async () => {
    refuse();
    const { deliver } = await load({ ...RESEND, NODE_ENV: "production", MAIL_DEBUG_LOG_BODIES: "true" });
    await deliver(MESSAGE);
    expect(logged()).not.toContain("123456");
  });

  // The flag governs delivered messages as well, or turning it on for staging
  // would quietly start printing every code in production too.
  it("withholds the body of a delivered message in production by default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"abc"}', { status: 200 })));
    const { deliver } = await load({ ...RESEND, NODE_ENV: "production", MAIL_DEBUG_LOG_BODIES: undefined });
    await expect(deliver(MESSAGE)).resolves.toBe("sent");
    expect(logged()).not.toContain("123456");
  });

  // Withheld is not silent: the flow still has to be traceable.
  it("still records an undelivered message against a masked address", async () => {
    refuse();
    const { deliver } = await load({ ...RESEND, NODE_ENV: "production", MAIL_DEBUG_LOG_BODIES: undefined });
    await deliver(MESSAGE);
    expect(logged()).toContain("s***@example.test");
    expect(logged()).not.toContain("123456");
  });
});

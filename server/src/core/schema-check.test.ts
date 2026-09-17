import { describe, expect, it } from "vitest";
import {
  DatabaseUnreachableError,
  isDatabaseUnreachable,
  rethrowKnownDbFailure,
  SchemaBehindError,
} from "./schema-check";

/**
 * The classifier decides which error page a person sees. A timeout that is
 * not recognised shows a raw stack; a real bug that is misread as a timeout
 * tells them to "try again" forever. Both directions matter.
 */

const withCode = (code: string, message = "") => Object.assign(new Error(message), { code });

describe("isDatabaseUnreachable", () => {
  it("recognises the pg socket errors", () => {
    for (const code of ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]) {
      expect(isDatabaseUnreachable(withCode(code))).toBe(true);
    }
  });

  it("recognises Prisma's own cannot-reach family", () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017"]) {
      expect(isDatabaseUnreachable(withCode(code))).toBe(true);
    }
  });

  it("recognises pg's own timeouts, which carry no code", () => {
    expect(isDatabaseUnreachable(new Error("timeout expired"))).toBe(true);
    expect(isDatabaseUnreachable(new Error("Connection terminated due to connection timeout"))).toBe(true);
    expect(isDatabaseUnreachable(new Error("Connection terminated unexpectedly"))).toBe(true);
  });

  it("recognises the shape Prisma hands back for a connect timeout — message on the error, none of it coded", () => {
    // Exactly what `db.session.findUnique` threw against a blackhole address with a ten-second pool timeout.
    const wrapped = new Error("Connection terminated due to connection timeout", {
      cause: new Error("Connection terminated unexpectedly"),
    });
    expect(isDatabaseUnreachable(wrapped)).toBe(true);
  });

  it("looks through a wrapping error to its cause", () => {
    const wrapped = new Error("Invalid `prisma.session.findUnique()` invocation", {
      cause: withCode("ETIMEDOUT"),
    });
    expect(isDatabaseUnreachable(wrapped)).toBe(true);
  });

  it("does not mistake a schema or constraint error for a network one", () => {
    expect(isDatabaseUnreachable(withCode("P2021"))).toBe(false);
    expect(isDatabaseUnreachable(withCode("P2002"))).toBe(false);
    expect(isDatabaseUnreachable(withCode("23505"))).toBe(false);
    expect(isDatabaseUnreachable(new Error("timeout expired while waiting for a lock"))).toBe(false);
    expect(isDatabaseUnreachable(null)).toBe(false);
    expect(isDatabaseUnreachable("ETIMEDOUT")).toBe(false);
  });
});

describe("rethrowKnownDbFailure", () => {
  it("turns a timeout into a DatabaseUnreachableError with the digest the error page reads", () => {
    let caught: unknown;
    try {
      rethrowKnownDbFailure(withCode("ETIMEDOUT"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseUnreachableError);
    expect((caught as DatabaseUnreachableError).digest).toBe("DATABASE_UNREACHABLE");
    expect((caught as DatabaseUnreachableError).code).toBe("ETIMEDOUT");
  });

  it("turns a missing table into a SchemaBehindError naming the model", () => {
    let caught: unknown;
    try {
      rethrowKnownDbFailure(Object.assign(new Error(), { code: "P2021", meta: { modelName: "Session" } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SchemaBehindError);
    expect((caught as SchemaBehindError).digest).toBe("SCHEMA_BEHIND");
    expect((caught as SchemaBehindError).missing).toBe("Session");
  });

  it("passes anything else through unchanged", () => {
    const original = withCode("P2002");
    expect(() => rethrowKnownDbFailure(original)).toThrow(original);
  });
});

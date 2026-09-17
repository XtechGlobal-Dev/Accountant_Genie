import "server-only";

/**
 * Recognise the two database failures that would otherwise 500 every page
 * with a raw stack trace, and say each one plainly.
 *
 *   - Behind the schema: Prisma reports a missing table or column as
 *     P2021 / P2022. The fix is to push the schema (local) or run the
 *     migrations (staging, production), and the message names the commands.
 *   - Unreachable: the connection timed out or was refused. Nothing in the
 *     code is wrong; the link to the database is. The fix is to wait, or to
 *     look at the network.
 *
 * Both errors carry a `digest`. Next passes a server error's digest to the
 * client error boundary even in production, where it strips the message, so
 * `app/error.tsx` can still tell which page to show.
 */

export const SCHEMA_BEHIND_MESSAGE =
  "The database schema is behind prisma/schema.prisma. " +
  "Run `npx prisma db push --accept-data-loss`, then `npm run db:constraints`, then `npm run db:seed`, and restart the dev server. " +
  "On staging or production run `prisma migrate deploy` instead.";

export const SCHEMA_BEHIND_DIGEST = "SCHEMA_BEHIND";

export class SchemaBehindError extends Error {
  readonly digest = SCHEMA_BEHIND_DIGEST;
  readonly missing: string | null;
  constructor(missing: string | null) {
    super(missing ? `${SCHEMA_BEHIND_MESSAGE} (missing: ${missing})` : SCHEMA_BEHIND_MESSAGE);
    this.name = "SchemaBehindError";
    this.missing = missing;
  }
}

export const DATABASE_UNREACHABLE_MESSAGE =
  "The database could not be reached: the connection timed out or was refused. " +
  "Nothing needs changing in the app — check the network, then try again.";

export const DATABASE_UNREACHABLE_DIGEST = "DATABASE_UNREACHABLE";

export class DatabaseUnreachableError extends Error {
  readonly digest = DATABASE_UNREACHABLE_DIGEST;
  /** The underlying code — ETIMEDOUT, ECONNREFUSED, P1001 … — for the log line. */
  readonly code: string | null;
  constructor(code: string | null) {
    super(code ? `${DATABASE_UNREACHABLE_MESSAGE} (${code})` : DATABASE_UNREACHABLE_MESSAGE);
    this.name = "DatabaseUnreachableError";
    this.code = code;
  }
}

/** Prisma's own "cannot reach the database" family. */
const PRISMA_UNREACHABLE = new Set(["P1001", "P1002", "P1008", "P1017"]);
/** What the pg driver reports when the socket never opens or drops. */
const SOCKET_UNREACHABLE = new Set(["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

const PG_TIMEOUT_MESSAGE =
  /^(timeout expired|Connection terminated due to connection timeout|Connection terminated unexpectedly)$/i;

function codeOf(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** True for a Prisma or pg error that means the database is unreachable, not wrong. */
export function isDatabaseUnreachable(error: unknown): boolean {
  const code = codeOf(error);
  if (code && (PRISMA_UNREACHABLE.has(code) || SOCKET_UNREACHABLE.has(code))) return true;
  // pg's own timeouts carry no code — only a message. "timeout expired" is
  // the pool giving up on acquiring a client; "Connection terminated due to
  // connection timeout" is a client giving up on the handshake, and the
  // "unexpectedly" form is the socket closing under it. Verified against a
  // blackhole address, not assumed.
  if (error instanceof Error && PG_TIMEOUT_MESSAGE.test(error.message)) return true;
  // Prisma wraps the adapter's error; the cause still carries the code.
  if (error instanceof Error && error.cause !== undefined && error.cause !== error) {
    return isDatabaseUnreachable(error.cause);
  }
  return false;
}

/** Rethrow a Prisma "table/column does not exist" as a SchemaBehindError; anything else passes through. */
export function rethrowIfSchemaBehind(error: unknown): never {
  const code = codeOf(error);
  if (code === "P2021" || code === "P2022") {
    const meta = (error as { meta?: { table?: unknown; column?: unknown; modelName?: unknown } }).meta;
    const missing = [meta?.modelName, meta?.table, meta?.column].find((v) => typeof v === "string") as string | undefined;
    console.error(`[db] ${SCHEMA_BEHIND_MESSAGE}`);
    throw new SchemaBehindError(missing ?? null);
  }
  throw error;
}

/** Rethrow a connection timeout or refusal as a DatabaseUnreachableError; anything else passes through. */
export function rethrowIfDatabaseUnreachable(error: unknown): never {
  if (isDatabaseUnreachable(error)) {
    const code = codeOf(error) ?? (error instanceof Error ? codeOf(error.cause) : null);
    console.error(`[db] ${DATABASE_UNREACHABLE_MESSAGE}${code ? ` (${code})` : ""}`);
    throw new DatabaseUnreachableError(code);
  }
  throw error;
}

/**
 * Both of the above, for the queries that run on every request — the session
 * lookup, the rate limiter. Anything that is neither passes through untouched.
 */
export function rethrowKnownDbFailure(error: unknown): never {
  if (isDatabaseUnreachable(error)) rethrowIfDatabaseUnreachable(error);
  rethrowIfSchemaBehind(error);
}

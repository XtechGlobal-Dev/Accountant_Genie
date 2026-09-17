import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma";

/**
 * The one Prisma client. Import `db` from here and nowhere else.
 *
 * `server-only` is the boundary marker: this module is the root of the backend
 * import graph, so any client component that reaches a repository or a service
 * — however indirectly — fails the build here rather than at runtime.
 */

// Next.js hot-reloads modules in dev, which would otherwise open a new pool on
// every edit until Postgres refuses connections. Cache the client on globalThis.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const CONNECT_TIMEOUT_MS = 10_000;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  // Prisma 7 connects through a driver adapter rather than a schema-level url.
  //
  // `connectionTimeoutMillis` bounds how long a request can hang on a link that
  // is dropping packets. Without it the pg pool waits on the OS's SYN retries,
  // the request sits for twenty-odd seconds, and the eventual ETIMEDOUT
  // surfaces through Prisma's batch interpreter as an unhandled
  // "object null is not iterable" — a crash rather than an error. Ten seconds
  // is well above Neon's cold start and well below anyone's patience.
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Built on first use, not on import.
 *
 * `next build` imports every route module to collect its configuration — even
 * a `force-dynamic` one, which is why marking the routes was not enough on its
 * own. A client constructed at module scope therefore demanded DATABASE_URL at
 * BUILD time, on a machine that has no business holding production credentials.
 * Deferring construction to the first query keeps the build a pure compile and
 * leaves the missing-variable error where it belongs: the first request.
 */
let instance: PrismaClient | undefined = globalForPrisma.prisma;

function client(): PrismaClient {
  if (!instance) {
    instance = createClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = instance;
  }
  return instance;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const active = client();
    const value = Reflect.get(active, property, active);
    // Model delegates are objects and are handed back as they are. The methods
    // on the client itself ($transaction, $queryRaw) lose `this` without a bind.
    return typeof value === "function" ? value.bind(active) : value;
  },
  has(_target, property) {
    return property in client();
  },
  set(_target, property, value) {
    return Reflect.set(client(), property, value);
  },
});

/**
 * The transaction-scoped client passed to a callback of `db.$transaction`.
 * Repository functions accept this so a service can compose several writes
 * into one transaction without the repository knowing whether it is in one.
 */
export type DbClient = Prisma.TransactionClient;

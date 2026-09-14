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

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  // Prisma 7 connects through a driver adapter rather than a schema-level url.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * The transaction-scoped client passed to a callback of `db.$transaction`.
 * Repository functions accept this so a service can compose several writes
 * into one transaction without the repository knowing whether it is in one.
 */
export type DbClient = Prisma.TransactionClient;

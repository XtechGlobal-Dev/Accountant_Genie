import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env for the CLI. Node 20.6+ can do it natively,
// so no dotenv dependency is needed.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent in CI — the environment is expected to provide the URLs.
}

/**
 * Schema commands (db push, migrate, introspect) must use the DIRECT connection.
 * Neon's pooler does not support the advisory locks Prisma takes during a
 * migration, so pointing these at the pooled URL fails intermittently and
 * confusingly. Falls back to DATABASE_URL for non-Neon setups.
 *
 * `prisma generate` reads this file too and never connects, so a missing URL
 * must not stop it: CI's typecheck and unit jobs generate the client with no
 * database at all. A placeholder stands in; any command that actually
 * connects fails on its own with a clear message from Postgres, and the
 * runtime client (`src/core/db.ts`) checks DATABASE_URL separately.
 */
const migrationUrl =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://unset:unset@localhost:5432/unset?schema=public";

if (!process.env.DIRECT_DATABASE_URL && !process.env.DATABASE_URL) {
  console.warn("[prisma] DIRECT_DATABASE_URL / DATABASE_URL not set — fine for `prisma generate`, fatal for anything that connects.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: migrationUrl,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

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
 */
const migrationUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("Set DIRECT_DATABASE_URL (or DATABASE_URL) in .env — see .env.example.");
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

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Must happen here, not in the test file: ES imports are hoisted, so core/db.ts
// evaluates (and reads DATABASE_URL) before any statement in the test body runs.
try {
  process.loadEnvFile(at("./.env"));
} catch {
  // Absent in CI — the environment is expected to provide DATABASE_URL.
}

/**
 * Integration tests against a real database (DATABASE_URL from server/.env):
 * the third enforcement leg of the ledger invariant (a trial balance sums to
 * zero after real postings and reversals), and the standing idempotency test
 * (an import run twice creates no duplicate rows).
 *
 *   npm run test:db
 *
 * Each file creates a throwaway firm and removes it afterwards. Never point
 * it at production.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@/server": at("./src"),
      "@/shared": at("./src/shared"),
      "@/generated": at("./generated"),
      "server-only": at("./tests/server-only.ts"),
    },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});

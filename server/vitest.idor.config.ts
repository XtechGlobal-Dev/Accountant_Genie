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
 * The IDOR suite runs against a real database (DATABASE_URL from server/.env)
 * and asserts that a user of Firm A receives "not found" for every resource of
 * Firm B, through the same services the routes call.
 *
 *   pnpm test:idor
 *
 * It creates two throwaway firms and removes them afterwards. Never point it
 * at production.
 *
 * `server-only` throws outside the React server condition, so it is aliased to
 * an empty module — see the note at the end of src/README.md.
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
    include: ["tests/idor/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

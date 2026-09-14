import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Unit tests for the pure parts: schemas, ledger validation, tax arithmetic and
 * report aggregation. Repositories need a database and are not covered here.
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
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/idor/**"],
    environment: "node",
  },
});

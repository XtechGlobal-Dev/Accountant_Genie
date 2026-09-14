import type { NextConfig } from "next";

/**
 * The backend owns the environment. Every secret lives in `server/.env` next to
 * the code that reads it, and every backend entry point (worker, seed, prisma,
 * tests) loads it from its own cwd. The Next process is the one caller that
 * does not, because Next only looks for a root `.env` — so load it here, before
 * any server component or server action runs. No NEXT_PUBLIC_* vars exist, so
 * nothing needs to be inlined into the client bundle at build time.
 */
try {
  process.loadEnvFile("server/.env");
} catch {
  // Absent in CI — the environment is expected to provide the variables.
}

const nextConfig: NextConfig = {
  // Off so it cannot overlap the sidebar footer in screenshots/reviews.
  devIndicators: false,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;

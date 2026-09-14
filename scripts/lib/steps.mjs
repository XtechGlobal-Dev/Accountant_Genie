/**
 * The individual things a local run needs done. Each step is independent and
 * reports what it did, so dev.mjs stays a readable list of intentions.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT, SERVER, binJs, c, log, run } from "./util.mjs";

const ENV = path.join(SERVER, ".env");
const ENV_EXAMPLE = path.join(SERVER, ".env.example");

/**
 * The backend owns the environment. Nothing else can run until server/.env
 * exists and names a database.
 */
export function ensureEnv() {
  log.step("Environment");

  if (!existsSync(ENV)) {
    if (!existsSync(ENV_EXAMPLE)) throw new Error(`Missing ${path.relative(ROOT, ENV_EXAMPLE)}`);
    copyFileSync(ENV_EXAMPLE, ENV);
    log.warn(`Created ${c.bold("server/.env")} from .env.example`);
    log.plain();
    log.plain(`    ${c.yellow("Set DATABASE_URL and DIRECT_DATABASE_URL in server/.env,")}`);
    log.plain(`    ${c.yellow("then run this again.")}`);
    log.plain();
    process.exit(1);
  }

  // Node reads .env natively; no dotenv dependency needed.
  process.loadEnvFile(ENV);

  const url = process.env.DATABASE_URL;
  if (!url || /USER:PASSWORD|<.*>|example\.com/i.test(url)) {
    log.fail("DATABASE_URL in server/.env is missing or still a placeholder.");
    log.plain();
    log.plain(`    Point it at your Neon database (or a local Postgres), then re-run.`);
    log.plain();
    process.exit(1);
  }

  log.ok(`server/.env loaded — ${describeDb(url)}`);
  return url;
}

function describeDb(url) {
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname} ${
      local ? c.dim("(local)") : c.yellow("(remote)")
    }`;
  } catch {
    return c.dim("(unparsable connection string)");
  }
}

/** Both packages must be installed before anything can be generated or served. */
export async function ensureDependencies() {
  log.step("Dependencies");
  const missing = [
    !existsSync(path.join(ROOT, "node_modules")) && "root",
    !existsSync(path.join(SERVER, "node_modules")) && "server",
  ].filter(Boolean);

  if (missing.length === 0) {
    log.ok("root and server packages installed");
    return;
  }

  log.warn(`node_modules missing for: ${missing.join(", ")} — installing`);
  // The root package.json uses the workspace: protocol, which only pnpm understands.
  await run("pnpm", ["install"], { cwd: ROOT }).catch(() => {
    log.fail("pnpm install failed. This repo is a pnpm workspace — install pnpm first:");
    log.plain(`    npm i -g pnpm`);
    process.exit(1);
  });
  log.ok("dependencies installed");
}

/** Prisma client — the generated types the whole backend imports as @/generated. */
export async function generateClient() {
  log.step("Prisma client");
  await run(process.execPath, [binJs(SERVER, "prisma"), "generate"], {
    cwd: SERVER,
    quiet: true,
  });
  log.ok("generated to server/generated/prisma");
}

/**
 * Sync the schema to the database. `--accept-data-loss` is deliberately NOT
 * passed: on a destructive change Prisma stops and asks rather than dropping
 * a column full of ledger rows.
 */
export async function pushSchema() {
  log.step("Database schema");
  await wakeDatabase();
  await runPrisma(["db", "push"]);
  log.ok("schema in sync");

  const constraints = path.join(SERVER, "prisma", "sql", "constraints.sql");
  if (existsSync(constraints)) {
    await runPrisma(["db", "execute", "--file", "prisma/sql/constraints.sql"]);
    log.ok("ledger CHECK constraints applied");
  }
}

/**
 * Neon suspends an idle compute, and the first connection pays a cold start of
 * ten seconds or more. Prisma's own connect timeout is shorter than that, so an
 * untouched database makes `db push` fail with P1001 even though nothing is
 * wrong. Open a plain `pg` connection first and wait for the wake-up.
 */
async function wakeDatabase() {
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) return;

  const require = createRequire(path.join(SERVER, "package.json"));
  const { Client } = require("pg");
  const started = Date.now();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      const ms = Date.now() - started;
      if (ms > 2_000) log.ok(`database awake ${c.dim(`(cold start, ${(ms / 1000).toFixed(1)}s)`)}`);
      return;
    } catch (err) {
      if (attempt === 3) {
        log.warn(`could not warm the database (${err.message}) — trying Prisma anyway`);
        return;
      }
    } finally {
      await client.end().catch(() => {});
    }
  }
}

/**
 * Run a Prisma CLI command, retrying once on P1001. A Neon compute can suspend
 * again between two steps of the same run, and a second attempt against a warm
 * endpoint succeeds immediately.
 */
async function runPrisma(args) {
  try {
    await run(process.execPath, [binJs(SERVER, "prisma"), ...args], { cwd: SERVER, quiet: true });
  } catch (err) {
    if (!/P1001|Can't reach database server/i.test(err.out ?? "")) throw err;
    log.warn("database was still asleep — waking it and retrying");
    await wakeDatabase();
    await run(process.execPath, [binJs(SERVER, "prisma"), ...args], { cwd: SERVER, quiet: true });
  }
}

/**
 * Seed only when the database has no firms. A populated database is left
 * exactly as it is — this must never clobber someone's working data.
 */
export async function seedIfEmpty({ force = false } = {}) {
  log.step("Demo data");

  if (!force) {
    const firms = await countFirms();
    if (firms === null) {
      log.warn("could not read the Firm table — skipping seed");
      return;
    }
    if (firms > 0) {
      log.ok(`database already has ${firms} firm(s) — leaving data untouched`);
      return;
    }
    log.info("database is empty — seeding");
  }

  await run(process.execPath, [binJs(SERVER, "tsx"), "prisma/seed.ts"], {
    cwd: SERVER,
    quiet: true,
  });
  log.ok("seeded: AU chart of accounts, demo firm, clients and journals");
}

/** Uses the server package's own `pg`, which is not resolvable from the root. */
async function countFirms() {
  const require = createRequire(path.join(SERVER, "package.json"));
  const { Client } = require("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  });
  try {
    await client.connect();
    const res = await client.query('SELECT COUNT(*)::int AS n FROM "Firm"');
    return res.rows[0].n;
  } catch {
    return null; // table not created yet, or unreachable — caller decides
  } finally {
    await client.end().catch(() => {});
  }
}

/** True when REDIS_URL is configured, meaning jobs run in a separate worker. */
export function workerEnabled() {
  return Boolean(process.env.REDIS_URL);
}

export function readPackageName() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).name;
}

/**
 * Bring a fresh database up to the current schema, then prove it.
 *
 *   node scripts/provision-db.mjs --verify                 # read-only: what is there now?
 *   node scripts/provision-db.mjs --apply                  # migrate + chart of accounts
 *
 * Connection strings come from the environment. Pass them inline so they never
 * land in a file:
 *
 *   DATABASE_URL="<pooled>" DIRECT_DATABASE_URL="<direct>" \
 *     node scripts/provision-db.mjs --apply
 *
 * Neon hands out TWO strings and both are needed. `prisma migrate deploy` takes
 * advisory locks that a connection pooler does not carry, so migrations run over
 * DIRECT_DATABASE_URL; the account sync is ordinary traffic and uses the pooled
 * DATABASE_URL.
 *
 * What it does NOT do is seed. `npm run db:seed` creates the "Meridian
 * Accounting" demo firm, which a database with real clients must never get.
 * `db:sync-accounts` installs only the system chart of accounts and is
 * idempotent, so this script is safe to re-run after every schema change.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// `pg` belongs to @ledgerly/server, not the root package, and npm does not hoist
// it. Resolve it the way the server package would rather than adding a root
// dependency that only this script needs.
const requireFromServer = createRequire(join(root, "server", "package.json"));
const args = process.argv.slice(2);
const apply = args.includes("--apply");

const pooled = process.env.DATABASE_URL?.trim();
const direct = process.env.DIRECT_DATABASE_URL?.trim();

if (!pooled || !direct) {
  console.error("\nBoth DATABASE_URL (pooled) and DIRECT_DATABASE_URL (direct) must be set.\n");
  console.error("  DATABASE_URL=\"<pooled>\" DIRECT_DATABASE_URL=\"<direct>\" \\");
  console.error("    node scripts/provision-db.mjs --apply\n");
  process.exit(1);
}
if (!direct.includes("-pooler") && pooled.includes("-pooler")) {
  // The expected shape. Anything else is worth saying out loud rather than
  // letting a migration hang on the pooler and look like a network problem.
} else {
  console.warn("\n  ! DATABASE_URL should contain \"-pooler\" and DIRECT_DATABASE_URL should not.");
  console.warn("    Check you have not swapped them; migrations over the pooler hang.\n");
}

/** Every model the schema declares — the list this database must end up matching. */
const expected = readFileSync(join(root, "server/prisma/schema.prisma"), "utf8")
  .split(/\r?\n/)
  .flatMap((line) => line.match(/^model\s+(\w+)/)?.slice(1) ?? [])
  .sort();

async function inspect() {
  const { Client } = requireFromServer("pg");
  const client = new Client({ connectionString: direct });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = expected.filter((m) => !present.has(m));

    let migrations = null;
    let accounts = null;
    if (present.has("_prisma_migrations")) {
      const m = await client.query(
        "select count(*)::int n from _prisma_migrations where finished_at is not null",
      );
      migrations = m.rows[0].n;
    }
    if (present.has("Account")) {
      const a = await client.query(
        'select count(*)::int n from "Account" where "firmId" is null and "clientId" is null',
      );
      accounts = a.rows[0].n;
    }

    // Sign-up commits the firm and the user in one transaction, and only then
    // issues the one-time code — which is the first thing to read AUTH_SECRET.
    // So a firm that exists behind a 500 says the transaction was fine and the
    // failure came after it: look at AUTH_SECRET and the mail provider, not at
    // the schema. No firm, and the transaction itself is what failed.
    const counts = {};
    for (const table of ["Firm", "User", "TaxRuleVersion"]) {
      if (!present.has(table)) continue;
      const r = await client.query(`select count(*)::int n from "${table}"`);
      counts[table] = r.rows[0].n;
    }
    return { tables: present.size, missing, migrations, accounts, counts };
  } finally {
    await client.end();
  }
}

function report(state, label) {
  console.log(`\n  ${label}`);
  console.log(`    tables               ${state.tables}`);
  console.log(`    migrations applied   ${state.migrations ?? "— no _prisma_migrations table"}`);
  console.log(`    system accounts      ${state.accounts ?? "—"}`);
  console.log(`    models expected      ${expected.length}`);
  if (state.missing.length > 0) {
    console.log(`    MISSING (${state.missing.length})        ${state.missing.join(", ")}`);
  } else {
    console.log("    missing              none");
  }
  const rows = Object.entries(state.counts ?? {});
  if (rows.length > 0) {
    console.log(`    rows                 ${rows.map(([t, n]) => `${t}=${n}`).join("  ")}`);
  }
  if (state.missing.length === 0 && state.counts?.Firm > 0) {
    console.log("\n    Firms exist. A 500 on sign-up is therefore NOT the schema — the");
    console.log("    firm/user transaction committed and the failure came after it.");
    console.log("    Check AUTH_SECRET is set on the host that served the request.");
  }
}

function run(label, command, commandArgs, env) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`\n  ${label} FAILED (exit ${result.status}). Nothing further attempted.\n`);
    process.exit(1);
  }
}

let before;
try {
  before = await inspect();
} catch (error) {
  // A wrong host, a revoked password or a deleted project all land here, and the
  // raw driver stack says none of that clearly. The URLs are pasted by hand, so
  // this is the likeliest failure of the whole script.
  console.error(`\n  Could not reach the database over DIRECT_DATABASE_URL.\n`);
  console.error(`  ${error.code ? `${error.code}: ` : ""}${error.message}\n`);
  if (error.code === "ENOTFOUND") {
    console.error("  The host does not resolve — check the string is current and complete.");
  } else if (/password|authentication/i.test(error.message)) {
    console.error("  Credentials rejected — re-copy the string from the Neon console.");
  }
  console.error();
  process.exit(1);
}
report(before, "BEFORE");

if (!apply) {
  console.log("\nRead-only. Re-run with --apply to migrate and sync the chart of accounts.\n");
  process.exit(before.missing.length === 0 ? 0 : 1);
}

// A database that already has application tables but no _prisma_migrations was
// built with `db push`. `migrate deploy` would try to create what is already
// there and fail on the init migration, so refuse rather than produce a
// confusing Postgres error half way through.
if (before.tables > 0 && before.migrations === null) {
  console.error("\n  This database has tables but no migration history — it was built with");
  console.error("  `db push`. `migrate deploy` would fail on the init migration.");
  console.error("  Use a fresh database, or baseline this one with:");
  console.error("    npx prisma migrate resolve --applied <migration-name>   (for each already reflected)\n");
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run("prisma migrate deploy", npm, ["run", "db:deploy"], { DIRECT_DATABASE_URL: direct });
run("system chart of accounts", npm, ["run", "db:sync-accounts"], { DATABASE_URL: pooled });

const after = await inspect();
report(after, "AFTER");

if (after.missing.length > 0) {
  console.error("\n  Tables are still missing. Do NOT point the app at this database.\n");
  process.exit(1);
}
if (!after.accounts) {
  console.error("\n  No system accounts. The chart of accounts did not install.\n");
  process.exit(1);
}
console.log("\n  Ready. Point DATABASE_URL / DIRECT_DATABASE_URL at it and redeploy.\n");

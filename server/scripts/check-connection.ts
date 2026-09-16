/**
 * Verifies both Neon connection strings before anything else runs.
 *
 * `npm run db:check`
 *
 * Catches the two mistakes that produce confusing failures later:
 *   1. Pooled and direct URLs swapped (migrations then fail intermittently)
 *   2. sslmode missing (Neon refuses the connection with an opaque error)
 */
import { Client } from "pg";

// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

const pooled = process.env.DATABASE_URL;
const direct = process.env.DIRECT_DATABASE_URL;

let problems = 0;

function warn(msg: string) {
  problems++;
  console.log(`  ! ${msg}`);
}

async function probe(label: string, url: string | undefined, expectPooler: boolean) {
  if (!url) {
    warn(`${label} is not set`);
    return;
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    warn(`${label} is not a valid URL`);
    return;
  }

  const isPooler = host.includes("-pooler");
  if (expectPooler && !isPooler) {
    warn(`${label} does not look pooled (host has no "-pooler"). Migrations may work but the app will exhaust connections.`);
  }
  if (!expectPooler && isPooler) {
    warn(`${label} points at the POOLER. Prisma db push / migrate will fail — use the direct URL here.`);
  }
  if (!/sslmode=/.test(url)) {
    warn(`${label} has no sslmode — append ?sslmode=require`);
  }

  const client = new Client({ connectionString: url });
  const started = Date.now();
  try {
    await client.connect();
    const { rows } = await client.query(
      "select current_database() as db, current_user as usr, version() as ver",
    );
    const ms = Date.now() - started;
    const version = String(rows[0].ver).split(" ").slice(0, 2).join(" ");
    console.log(`  ok  ${label}`);
    console.log(`        host     ${host}`);
    console.log(`        database ${rows[0].db} as ${rows[0].usr}`);
    console.log(`        server   ${version}  (${ms}ms)`);
    await client.end();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn(`${label} could not connect: ${msg}`);
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

async function main() {
  console.log("Checking Neon connections…\n");
  await probe("DATABASE_URL        (pooled)", pooled, true);
  console.log();
  await probe("DIRECT_DATABASE_URL (direct)", direct, false);

  console.log();
  if (problems === 0) {
    console.log("Both connections are good. Next: npm run bootstrap\n");
  } else {
    console.log(`${problems} problem(s) found — see .env.example for the expected shape.\n`);
    process.exitCode = 1;
  }
}

main();

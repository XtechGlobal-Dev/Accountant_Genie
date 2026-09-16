#!/usr/bin/env node
/**
 * One command to run Accountant Genie locally:
 *
 *   npm run dev
 *
 * Backend first, then the frontend — because the frontend cannot render a page
 * without the generated Prisma client and a schema that matches it:
 *
 *   1. server/.env            exists and names a real database
 *   2. dependencies           both packages installed
 *   3. prisma generate        the types the backend imports as @/generated
 *   4. prisma db push         schema synced, ledger CHECK constraints applied
 *   5. seed (only if empty)   never touches a database that already has data
 *   6. next dev  (+ worker)   the app itself
 *
 * Flags:
 *   --skip-db     skip steps 3–5 (fast restart when nothing schema-related changed)
 *   --seed        force a reseed even if the database already has firms
 *   --port <n>    dev server port (default 3000)
 *   --no-open     do not open a browser (also: BROWSER=none, or any CI)
 */
import { ROOT, SERVER, binJs, c, log, startLongRunning } from "./lib/util.mjs";
import {
  browserOpenEnabled,
  ensureDependencies,
  ensureEnv,
  generateClient,
  openWhenReady,
  pushSchema,
  seedIfEmpty,
  workerEnabled,
} from "./lib/steps.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const port = valueOf("--port", process.env.PORT || "3000");
const url = `http://localhost:${port}`;

log.plain();
log.plain(`  ${c.bold(c.blue("Accountant Genie"))} ${c.dim("· local development")}`);

ensureEnv();
await ensureDependencies();

// The preflight is where things go wrong, and a step that fails has usually
// already said why. Report the failure as a failure rather than as a stack
// trace from inside a child-process helper, and keep whatever the tool said.
try {
  if (has("--skip-db")) {
    log.step("Database");
    log.warn("skipped (--skip-db)");
  } else {
    await generateClient();
    await pushSchema();
    await seedIfEmpty({ force: has("--seed") });
  }
} catch (err) {
  log.plain();
  log.fail(err.message);
  const out = (err.out ?? "").trim();
  if (out) {
    log.plain();
    for (const line of out.split(/\r?\n/)) log.plain(`    ${c.dim(line)}`);
  }
  log.plain();
  process.exit(1);
}

log.step("Starting");

const children = [];

if (workerEnabled()) {
  log.ok(`worker  ${c.dim("REDIS_URL set — jobs run out of process")}`);
  children.push(
    startLongRunning(
      "worker",
      c.yellow,
      process.execPath,
      [binJs(SERVER, "tsx"), "scripts/worker.ts"],
      { cwd: SERVER },
    ),
  );
} else {
  log.info(c.dim("worker  not started — no REDIS_URL, jobs run in process"));
}

log.ok(`app     ${c.bold(url)}`);
const opening = browserOpenEnabled(argv);
if (opening) log.info(c.dim("        opening in your browser once it answers…"));
log.plain();

children.push(
  startLongRunning(
    "app",
    c.blue,
    process.execPath,
    [binJs(ROOT, "next"), "dev", "--port", String(port)],
    { cwd: ROOT },
  ),
);

// Polls in the background rather than blocking: the terminal stays live, and
// Ctrl-C during the first compile cancels the tab instead of racing it.
const cancelOpen = opening ? openWhenReady(url) : null;

// One Ctrl-C should take the whole thing down, worker included.
let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  cancelOpen?.();
  log.plain();
  log.plain(`  ${c.dim("shutting down…")}`);
  for (const child of children) child.kill(signal === "SIGINT" ? "SIGINT" : "SIGTERM");
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// If any child dies on its own, stop the rest rather than leaving half a stack up.
for (const child of children) {
  child.on("close", (code) => {
    if (!closing) {
      log.plain();
      log.fail(`a process exited with code ${code} — stopping the rest`);
      shutdown("SIGTERM");
      process.exitCode = code ?? 1;
    }
  });
}

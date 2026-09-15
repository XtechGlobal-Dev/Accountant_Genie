/**
 * Shared plumbing for everything in scripts/: paths, coloured logging and
 * child-process helpers that behave the same on Windows and POSIX.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SERVER = path.join(ROOT, "server");

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
};

let step = 0;
export const log = {
  step: (msg) => console.log(`\n${c.cyan(c.bold(`[${++step}]`))} ${c.bold(msg)}`),
  info: (msg) => console.log(`    ${msg}`),
  ok: (msg) => console.log(`    ${c.green("✓")} ${msg}`),
  warn: (msg) => console.log(`    ${c.yellow("!")} ${msg}`),
  fail: (msg) => console.log(`    ${c.red("✗")} ${msg}`),
  plain: (msg = "") => console.log(msg),
};

/**
 * Resolve a CLI's JavaScript entrypoint so it can be run as `node <file>`.
 *
 * The obvious route — spawning node_modules/.bin/<name> — needs a shell on
 * Windows, where those are .CMD shims. A shell then splits this repo's path on
 * the space in "Gaurav Mehra" and the command dies. Going straight to the JS
 * skips shells, quoting and platform differences entirely.
 */
export function binJs(pkgDir, pkgName, binName = pkgName) {
  let pkgJsonPath;
  const direct = path.join(pkgDir, "node_modules", pkgName, "package.json");
  if (existsSync(direct)) {
    pkgJsonPath = direct;
  } else {
    try {
      pkgJsonPath = createRequire(path.join(pkgDir, "package.json")).resolve(
        `${pkgName}/package.json`,
      );
    } catch {
      throw new Error(
        `"${pkgName}" is not installed in ${path.relative(ROOT, pkgDir) || "."}. Run: npm install`,
      );
    }
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!rel) throw new Error(`"${pkgName}" declares no bin entry named "${binName}"`);
  return path.resolve(path.dirname(pkgJsonPath), rel);
}

/**
 * How to invoke npm on this platform, as a [command, args] pair.
 *
 * Windows npm is a .cmd shim, which Node cannot spawn directly — it needs
 * cmd. Nothing path-shaped is passed as an argument, so the shell has
 * nothing to split on this repo's path; the working directory goes through
 * spawn's own `cwd`, which never reaches a shell. See binJs() above for the
 * hazard this sidesteps.
 */
export function npmInvocation(args) {
  return process.platform === "win32" ? ["cmd", ["/c", "npm", ...args]] : ["npm", args];
}

const label = (cmd, args) =>
  cmd === process.execPath ? path.basename(args[0] ?? "node") : path.basename(cmd);

/** Run a command to completion. Rejects on a non-zero exit unless `allowFail`. */
export function run(cmd, args, { cwd = ROOT, quiet = false, allowFail = false, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFail) resolve({ code, out });
      else reject(Object.assign(new Error(`${label(cmd, args)} exited with ${code}`), { out }));
    });
  });
}

/**
 * Start a long-running process, prefixing each of its lines so two servers can
 * share one terminal without their output becoming unreadable.
 */
export function startLongRunning(label, colour, cmd, args, { cwd = ROOT, env } = {}) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const tag = colour(`[${label}]`);
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) console.log(`${tag} ${line}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

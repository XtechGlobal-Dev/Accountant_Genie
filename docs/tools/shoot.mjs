/**
 * Screenshot a set of app routes for visual review.
 *   node scripts/shoot.mjs /clients /accounts
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const routes = process.argv.slice(2);
if (routes.length === 0) routes.push("/clients");

mkdirSync("scripts/shots", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

for (const route of routes) {
  const name = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `scripts/shots/${name}.png`, fullPage: false });
  console.log(`  ${route} -> scripts/shots/${name}.png`);
}

if (errors.length) {
  console.log(`\n  ${errors.length} console error(s):`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    ${e}`);
} else {
  console.log("\n  no console errors");
}

await browser.close();

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Reuse the exact document the PDF pipeline builds.
const doc = readFileSync("docs/pdf/.print.debug.html", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(pathToFileURL("docs/pdf/.print.debug.html").href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

for (const media of ["screen", "print"]) {
  await page.emulateMedia({ media });
  const info = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const r = document.createRange();
    r.selectNodeContents(h1);
    return {
      family: getComputedStyle(h1).fontFamily.split(",")[0],
      width: Math.round(r.getBoundingClientRect().width),
      check400: document.fonts.check('400 20px "Newsreader"'),
      check500: document.fonts.check('500 40px "Newsreader"'),
      sansCheck: document.fonts.check('400 16px "IBM Plex Sans"'),
    };
  });
  console.log(`${media.padEnd(7)}`, JSON.stringify(info));
  await page.screenshot({ path: `scripts/shots/print-${media}.png`, clip: { x: 0, y: 0, width: 900, height: 400 } });
}
await browser.close();

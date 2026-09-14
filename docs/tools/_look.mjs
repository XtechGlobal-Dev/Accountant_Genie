import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch();
// A4 at 96dpi ≈ 794 x 1123, matching the PDF's print column.
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL("docs/pdf/.print.debug.html").href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });
await page.screenshot({ path: "scripts/shots/pdf-p1.png", clip: { x: 0, y: 0, width: 794, height: 1000 } });
const y = await page.evaluate(() => document.querySelectorAll("figure")[0].getBoundingClientRect().top + window.scrollY);
await page.screenshot({ path: "scripts/shots/pdf-fig1.png", clip: { x: 0, y: Math.max(0, y - 20), width: 794, height: 620 } });
await browser.close();
console.log("wrote scripts/shots/pdf-p1.png and pdf-fig1.png");

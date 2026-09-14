/**
 * Render an artifact HTML fragment to a print-quality PDF.
 *
 *   node scripts/to-pdf.mjs docs/how-ezyiah-works.html
 *
 * The source files are artifact fragments — no <!doctype>, <html> or <body>,
 * because the artifact host supplies those at publish time. This wraps the
 * fragment in a real document, forces the light theme (a dark PDF is useless on
 * paper), applies print rules the screen layout does not need, and waits for
 * webfonts so headings do not render in a fallback face.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Chromium re-renders in a print context for page.pdf(), and does not re-resolve
 * remote @font-face sources at that point — the document looks correct on screen
 * and then silently exports in Arial. Inlining every face as a data: URI removes
 * the network from the print path entirely.
 *
 * Responses are cached under .cache/fonts so repeat runs work offline.
 */
const FONT_CACHE = ".cache/fonts";

async function inlineGoogleFonts(linkTags) {
  mkdirSync(FONT_CACHE, { recursive: true });

  /* Deliberately a plain UA, so Google Fonts serves TrueType rather than woff2.
     Chromium's PDF embedder does not reliably embed woff2 faces — the page
     renders correctly on screen and in print media emulation, then exports with
     Georgia and Segoe UI substituted. TTF embeds every time. Verified: a modern
     Chrome UA yields woff2, an older one woff, and a bare UA truetype. */
  const UA = "curl/8.0";

  const sheets = [];
  for (const tag of linkTags) {
    const href = tag.match(/href="([^"]+)"/)?.[1];
    if (!href || !href.includes("fonts.googleapis.com/css")) continue;

    const key = join(FONT_CACHE, Buffer.from(href).toString("base64url").slice(0, 60) + ".css");
    let css;
    if (existsSync(key)) {
      css = readFileSync(key, "utf8");
    } else {
      const r = await fetch(href, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`Google Fonts returned ${r.status} for ${href}`);
      css = await r.text();
      writeFileSync(key, css);
    }
    sheets.push(css);
  }

  let combined = sheets.join("\n");

  /* Keep only the Latin subsets. Google ships one @font-face per unicode-range
     (cyrillic, greek, vietnamese, …); embedding all of them as base64 produced
     ~800KB of CSS for glyphs this document never uses. */
  const faces = combined.split(/(?=@font-face)/).filter((b) => b.includes("@font-face"));
  const latinOnly = faces.filter((b) => {
    const range = b.match(/unicode-range:\s*([^;]+)/)?.[1] ?? "";
    // U+0000-00FF is the Latin block; latin-ext adds U+0100.. — keep both.
    return !range || /U\+0000|U\+0100|U\+0102|U\+0130/.test(range);
  });

  /* Google's TrueType endpoint returns ONE variable font file for every declared
     face of a variable family — italic and all weights share a byte-identical
     payload. Chromium then resolves that file to its italic instance, so an
     italic @font-face declaration turns the entire document italic. Dropping the
     italic declaration leaves only upright faces; real <em> text is synthesised,
     which is correct here and invisible at body size. */
  const upright = latinOnly.filter((b) => !/font-style:\s*italic/.test(b));

  /* `font-display: swap` lets the fallback render first. Chromium's print pass
     can capture that fallback instead of the loaded face, which is exactly the
     silent-Arial failure this whole function exists to prevent. */
  combined = upright.join("\n").replace(/font-display:\s*swap/g, "font-display: block");

  const urls = [...new Set([...combined.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];

  let embedded = 0;
  for (const url of urls) {
    const ext = url.split(".").pop().split("?")[0];
    const key = join(FONT_CACHE, Buffer.from(url).toString("base64url").slice(0, 60) + "." + ext);
    let buf;
    if (existsSync(key)) {
      buf = readFileSync(key);
    } else {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(key, buf);
    }
    const mime = ext === "ttf" ? "font/ttf" : ext === "woff" ? "font/woff" : "font/woff2";
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    combined = combined.split(url).join(dataUri);
    embedded++;
  }

  return { css: combined, embedded, total: urls.length };
}

const input = process.argv[2] ?? "docs/how-ezyiah-works.html";
const outDir = "docs/pdf";
const outFile = join(outDir, basename(input).replace(/\.html?$/i, ".pdf"));

mkdirSync(outDir, { recursive: true });

const fragment = readFileSync(input, "utf8");

/* Print overrides.
   Two problems the screen stylesheet does not have:
   1. SVG label text is sized for a ~1140px viewport. Scaled into an A4 column
      it drops to ~7px, which is unreadable. Bump the label classes for print.
   2. Figures, tables and callouts must not split across a page break. */
const printCss = `
  @page {
    size: A4;
    margin: 16mm 14mm 18mm;
  }

  html, body { background: #ffffff !important; }

  .sheet { max-width: 100% !important; padding: 0 !important; }

  header.masthead { padding-top: 0 !important; }

  /* Sections start clean, but do not force a break before the first one. */
  section { break-inside: auto; padding: 1.6rem 0 !important; }
  section + section { break-before: page; }

  figure, .callout, .stage-grid, .tbl-wrap, table { break-inside: avoid; }
  figure { box-shadow: none !important; page-break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  figcaption { break-before: avoid; }

  /* SVGs are laid out for a wide viewport; give the labels back their
     legibility once the drawing is scaled into an A4 column. */
  figure svg { min-width: 0 !important; }
  .lbl   { font-size: 15px !important; }
  .lbl-s { font-size: 13px !important; }
  .lbl-m { font-size: 13.5px !important; }
  .lbl-t { font-size: 12.5px !important; }

  /* Hairlines survive the printer. */
  .edge, .edge-acc, .edge-dash { stroke-width: 1.6 !important; }

  a { text-decoration: none; }
`;

const linkTags = fragment.match(/<link[^>]*>/g) ?? [];
const fonts = await inlineGoogleFonts(linkTags);

const doc = `<!doctype html>
<html lang="en-AU" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280">
<style>${fonts.css}</style>
</head>
<body>
${fragment.replace(/<link[^>]*>/g, "")}
<style>${printCss}</style>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("requestfailed", (r) => problems.push(`${r.url()} — ${r.failure()?.errorText}`));

/* Navigate a real file:// URL rather than using setContent().
   setContent loads against an about:blank base, and Chromium's print pass does
   not reliably resolve @font-face from that context — the page looks right on
   screen and exports with fallback faces. A real document load behaves normally. */
const tmpHtml = join(outDir, ".print.html");
writeFileSync(tmpHtml, doc, "utf8");
await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "load" });

// networkidle can settle before the faces finish decoding.
await page.evaluate(() => document.fonts.ready);

// Confirm the display face actually loaded rather than silently falling back.
const fontOk = await page.evaluate(() => document.fonts.check('500 40px "Newsreader"'));

await page.pdf({
  path: outFile,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `
    <div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#7b8894;
                padding:0 14mm;display:flex;justify-content:space-between;">
      <span>Inside Ezyiah · competitive teardown</span>
      <span class="pageNumber"></span>
    </div>`,
});

writeFileSync(join(outDir, ".print.debug.html"), doc, "utf8");
rmSync(tmpHtml, { force: true });
await browser.close();

console.log(`\n  ${input}  ->  ${outFile}`);
console.log(`  fonts inlined: ${fonts.embedded}/${fonts.total} faces as data URIs`);
console.log(`  display face resolves: ${fontOk ? "yes" : "NO"}`);
if (problems.length) {
  console.log(`\n  ${problems.length} load problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 6)) console.log(`    ${p}`);
} else {
  console.log("  no load errors");
}

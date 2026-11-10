/* Generuje ikony RiC (PNG 16–512 i ICO dla instalatora Windows) z app/assets/icons/ric.svg.
   Uruchom:  NODE_PATH=$(npm root -g) node tools/make-icons.mjs   (wymaga Playwright + Chromium) */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "app", "assets", "icons");
const svg = readFileSync(join(DIR, "ric.svg"), "utf8");
const SIZES = [16, 24, 32, 48, 64, 128, 180, 256, 512];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const png = {};
for (const s of SIZES) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
  png[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
for (const s of [180, 512]) writeFileSync(join(DIR, `ric-${s}.png`), png[s]);

// ICO z obrazami PNG (format obsługiwany od Windows Vista)
const ico = [16, 24, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
let off = head.length;
ico.forEach((s, i) => {
  const e = 6 + 16 * i, b = png[s];
  head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
  off += b.length;
});
writeFileSync(join(DIR, "ric.ico"), Buffer.concat([head, ...ico.map(s => png[s])]));
console.log("Zapisano ikony RiC:", ["ric-180.png", "ric-512.png", "ric.ico"].join(", "));

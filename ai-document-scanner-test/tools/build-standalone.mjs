#!/usr/bin/env node
// @ts-check
/* =========================================================================
   Budowa programu próbnego: standalone/AI_Skaner_Dokumentow.html (jeden plik, offline)

   Do pliku trafiają:
     * aplikacja (standalone/src/main.mjs + wspólna logika src/*.mjs) — esbuild → IIFE,
     * style (public/styles.css + standalone/src/standalone.css),
     * Tesseract.js (biblioteka + worker) i rdzeń WebAssembly SIMD/LSTM (gzip),
     * polskie dane językowe OCR (4.0.0_best_int, gzip),
     * kartoteki przykładowe ERP i przykładowe dokumenty.
   Plik otwiera się dwuklikiem (file://) — bez serwera, bez internetu, bez kluczy.
   ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { MODULE_ROOT } from "../src/config.mjs";

const require = createRequire(import.meta.url);
const OUT = join(MODULE_ROOT, "standalone", "AI_Skaner_Dokumentow.html");
const pkg = JSON.parse(readFileSync(join(MODULE_ROOT, "package.json"), "utf8"));

const tessDir = dirname(require.resolve("tesseract.js/package.json"));
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
const polDir = dirname(require.resolve("@tesseract.js-data/pol/package.json"));
const versions = {
  "tesseract.js": require("tesseract.js/package.json").version,
  "tesseract.js-core": require("tesseract.js-core/package.json").version,
  "@tesseract.js-data/pol": require("@tesseract.js-data/pol/package.json").version
};

/** Treść bezpieczna wewnątrz <script>…</script>. */
const scriptSafe = s => String(s).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const b64 = buf => Buffer.from(buf).toString("base64");

// 1. aplikacja
const bundle = await build({
  entryPoints: [join(MODULE_ROOT, "standalone", "src", "main.mjs")],
  bundle: true, format: "iife", platform: "browser", target: ["chrome90", "firefox90", "safari15"],
  minify: true, legalComments: "none", write: false, logLevel: "warning",
  banner: { js: `/* ResInvest ERP — Skaner dokumentów (próbny) ${pkg.version}. Program stworzony przez Roesner Mateusz dla ResInvest Commodities. */` }
});
const appJs = bundle.outputFiles[0].text;

// 2. style
const css = readFileSync(join(MODULE_ROOT, "public", "styles.css"), "utf8") + "\n" + readFileSync(join(MODULE_ROOT, "standalone", "src", "standalone.css"), "utf8");

// 3. OCR
const tesseractJs = readFileSync(join(tessDir, "dist", "tesseract.min.js"), "utf8");
const workerJs = readFileSync(join(tessDir, "dist", "worker.min.js"));
const coreJs = readFileSync(join(coreDir, "tesseract-core-simd-lstm.wasm.js"));
const pol = readFileSync(join(polDir, "4.0.0_best_int", "pol.traineddata.gz"));

// 4. dane przykładowe
const master = readFileSync(join(MODULE_ROOT, "samples", "erp-master-data.sample.json"), "utf8");
const sampleLabels = [[/^kwit-wywozowy/, "Kwit wywozowy"], [/^wz-/, "WZ"], [/^pz-/, "PZ"], [/^kwit-wagowy-uszkodzony/, "Kwit wagowy (uszkodzony)"], [/^kwit-wagowy/, "Kwit wagowy"]];
const samplesHtml = readdirSync(join(MODULE_ROOT, "samples")).filter(f => f.endsWith(".png"))
  .map(f => ({ f, i: sampleLabels.findIndex(([re]) => /** @type {RegExp} */ (re).test(f)) }))
  .sort((a, b) => a.i - b.i)
  .map(({ f, i }) => `<script type="application/octet-stream" data-sample="${i >= 0 ? sampleLabels[i][1] : f}">${b64(readFileSync(join(MODULE_ROOT, "samples", f)))}</script>`).join("\n  ");

// 5. składanie
const parts = {
  "/*__STYLES__*/": css.replace(/<\/style/gi, "<\\/style"),
  "/*__MASTER__*/": master.replace(/</g, "\\u003c"),
  "<!--__SAMPLES__-->": samplesHtml,
  "/*__WORKER__*/": b64(workerJs),
  "/*__CORE__*/": b64(gzipSync(coreJs, { level: 9 })),
  "/*__POL__*/": b64(pol),
  "/*__TESSERACT__*/": scriptSafe(tesseractJs),
  "/*__APP__*/": scriptSafe(appJs)
};
let html = readFileSync(join(MODULE_ROOT, "standalone", "src", "template.html"), "utf8");
for (const [k, v] of Object.entries(parts)) {
  if (!html.includes(k)) throw new Error("Brak znacznika w szablonie: " + k);
  html = html.split(k).join(v);
}
if (/https?:\/\/(?!www\.w3\.org)[^"'\s)]*\.(js|wasm|gz|css)\b/i.test(appJs)) console.warn("UWAGA: w aplikacji jest adres sieciowy zasobu — program ma działać offline.");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
const sha = createHash("sha256").update(html).digest("hex").slice(0, 12);
writeFileSync(join(MODULE_ROOT, "standalone", "build-info.json"), JSON.stringify({ file: "AI_Skaner_Dokumentow.html", version: pkg.version, builtAt: new Date().toISOString(), sha256_12: sha, bytes: statSync(OUT).size, ocr: versions }, null, 2) + "\n");
console.log(`STANDALONE OK — ${OUT} (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, sha ${sha}; Tesseract.js ${versions["tesseract.js"]}, język pol ${versions["@tesseract.js-data/pol"]})`);

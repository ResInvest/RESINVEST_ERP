#!/usr/bin/env node
// @ts-check
/* =========================================================================
   Build modułu AI Document Scanner Test → dist/

   1. Kontrole przed budową:
      * składnia wszystkich plików JS (node --check),
      * brak sekretów w plikach interfejsu (klucze API nigdy nie trafiają do przeglądarki),
      * brak zasobów zewnętrznych (CDN) w interfejsie — zgodność z CSP 'self',
      * każde getElementById("…") z app.js istnieje w index.html,
      * fixture providera mock zgadzają się z obrazami (SHA-256) i schematem pól.
   2. Kopia public/ → dist/ z wersjonowaniem zasobów (?v=<skrót>) i build-info.json.
   Serwer automatycznie serwuje dist/, jeśli istnieje.
   ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { MODULE_ROOT } from "../src/config.mjs";
import { FIELD_KEYS, DOC_TYPE_KEYS } from "../src/schema.mjs";

const errors = [];
const pub = join(MODULE_ROOT, "public"), dist = join(MODULE_ROOT, "dist");
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// 1a. składnia
const jsFiles = ["src", "server", "tools", "tests", "public"].flatMap(d => walk(join(MODULE_ROOT, d))).filter(f => /\.(m?js|cjs)$/.test(f));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { errors.push(`Składnia: ${relative(MODULE_ROOT, f)}: ${String(e.stderr || e.message).split("\n").slice(0, 3).join(" ")}`); }
}

// 1b–1c. sekrety i zasoby zewnętrzne w interfejsie
const SECRET = [/sk-ant-[a-z0-9_-]{8,}/i, /ANTHROPIC_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/, /x-api-key/i, /api\.anthropic\.com/i];
for (const f of walk(pub)) {
  const t = readFileSync(f, "utf8");
  for (const re of SECRET) if (re.test(t)) errors.push(`Możliwy sekret / bezpośrednie wywołanie API w interfejsie: ${relative(MODULE_ROOT, f)} (${re})`);
  const ext = t.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || t.match(/@import\s+url\(\s*["']?https?:/gi) || t.match(/fetch\(\s*["']https?:/gi);
  if (ext) errors.push(`Zasób zewnętrzny w interfejsie (CSP 'self'): ${relative(MODULE_ROOT, f)}: ${ext[0]}`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(t) && f.endsWith(".html")) errors.push(`Skrypt inline w ${relative(MODULE_ROOT, f)} — zablokuje go CSP.`);
}

// 1d. identyfikatory elementów
const html = readFileSync(join(pub, "index.html"), "utf8"), app = readFileSync(join(pub, "app.js"), "utf8");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
for (const m of app.matchAll(/\$\("([^"]+)"\)/g)) if (!ids.has(m[1])) errors.push(`app.js odwołuje się do nieistniejącego elementu #${m[1]}`);

// 1e. fixture
const fxDir = join(MODULE_ROOT, "samples", "fixtures");
for (const f of readdirSync(fxDir).filter(x => x.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(join(fxDir, f), "utf8"));
  let sha;
  try { sha = createHash("sha256").update(readFileSync(join(MODULE_ROOT, "samples", j.file))).digest("hex"); } catch { errors.push(`Fixture ${f}: brak obrazu ${j.file}`); continue; }
  if (sha !== j.sha256) errors.push(`Fixture ${f}: SHA-256 nie zgadza się z ${j.file} (uruchom npm run samples)`);
  if (!DOC_TYPE_KEYS.includes(j.raw.docType.value)) errors.push(`Fixture ${f}: nieznany typ ${j.raw.docType.value}`);
  const keys = Object.keys(j.raw.fields).sort().join(","), want = [...FIELD_KEYS].sort().join(",");
  if (keys !== want) errors.push(`Fixture ${f}: pola nie zgadzają się ze schematem`);
}

if (errors.length) {
  console.error("BUILD NIEUDANY:\n - " + errors.join("\n - "));
  process.exit(1);
}

// 2. dist
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const hash = f => createHash("sha256").update(readFileSync(join(pub, f))).digest("hex").slice(0, 10);
const versions = { "styles.css": hash("styles.css"), "app.js": hash("app.js") };
const outHtml = html.replace('href="styles.css"', `href="styles.css?v=${versions["styles.css"]}"`).replace('src="app.js"', `src="app.js?v=${versions["app.js"]}"`);
writeFileSync(join(dist, "index.html"), outHtml);
for (const f of ["styles.css", "app.js"]) writeFileSync(join(dist, f), readFileSync(join(pub, f)));
const pkg = JSON.parse(readFileSync(join(MODULE_ROOT, "package.json"), "utf8"));
writeFileSync(join(dist, "build-info.json"), JSON.stringify({ module: pkg.name, version: pkg.version, builtAt: new Date().toISOString(), assets: versions, checkedFiles: jsFiles.length }, null, 2));
console.log(`BUILD OK — dist/ (sprawdzono ${jsFiles.length} plików JS, ${readdirSync(fxDir).length} fixture; app.js v${versions["app.js"]}, styles.css v${versions["styles.css"]})`);

#!/usr/bin/env node
/* Wyciąga teksty do tłumaczenia z kodu (t("…"), tp("…", n), th("…"), N_("…"))
   i porównuje ze słownikami app/src/i18n.dNN.js (pary CS/EN).
   Użycie:  node tools/i18n-extract.mjs            — raport pokrycia (kod wyjścia 1 przy brakach)
            node tools/i18n-extract.mjs --missing  — lista brakujących kluczy (JSON)  */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = [join(ROOT, "app", "src"), join(ROOT, "server")];
const CALL = /\b(?:t|tp|th|N_|Lx|I18N\.t|I18N\.tp)\(\s*"((?:[^"\\]|\\.)*)"/g;

export function extract() {
  const keys = new Map();
  for (const dir of DIRS) {
    let files = [];
    try { files = readdirSync(dir).filter(f => /\.(js|mjs)$/.test(f) && !/^i18n\.d\d+\.js$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      let m;
      while ((m = CALL.exec(src))) {
        const key = JSON.parse(`"${m[1]}"`);
        if (!key.trim()) continue;
        if (!keys.has(key)) keys.set(key, `${f}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  return keys;
}
export function dictionaries() {
  const require = createRequire(import.meta.url);
  const I = require(join(ROOT, "app", "src", "i18n.js"));
  const src = join(ROOT, "app", "src");
  for (const f of readdirSync(src).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require(join(src, f));
  return I.dict;
}
/** Placeholdery {x} i liczba form liczby mnogiej muszą się zgadzać z tekstem źródłowym. */
export function problems(keys, dict) {
  const out = [];
  const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  for (const lang of ["cs", "en"]) for (const k of keys.keys()) {
    const v = dict[lang][k];
    if (v === undefined) { out.push({ lang, key: k, problem: "missing" }); continue; }
    const srcForms = k.split("|"), dstForms = String(v).split("|");
    const same = srcForms.length === 1 ? ph(k) === ph(v) : srcForms.every(f => dstForms.every(g => ph(g) === ph(f)));
    if (!same) out.push({ lang, key: k, problem: "placeholders" });
    if (srcForms.length > 1 && dstForms.length < 2) out.push({ lang, key: k, problem: "plural" });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("i18n-extract.mjs")) {
  const keys = extract(), dict = dictionaries(), pr = problems(keys, dict);
  if (process.argv.includes("--missing")) {
    const miss = [...new Set(pr.filter(p => p.problem === "missing").map(p => p.key))];
    console.log(JSON.stringify(miss, null, 1));
  } else {
    const unused = lang => Object.keys(dict[lang]).filter(k => !keys.has(k));
    console.log(`Kluczy w kodzie: ${keys.size}`);
    for (const lang of ["cs", "en"]) console.log(`${lang}: brakuje ${pr.filter(p => p.lang === lang && p.problem === "missing").length}, błędne placeholdery ${pr.filter(p => p.lang === lang && p.problem !== "missing").length}, nieużywane ${unused(lang).length}`);
    pr.filter(p => p.problem !== "missing").slice(0, 20).forEach(p => console.log(" ", p.lang, p.problem, JSON.stringify(p.key)));
    process.exit(pr.length ? 1 : 0);
  }
}

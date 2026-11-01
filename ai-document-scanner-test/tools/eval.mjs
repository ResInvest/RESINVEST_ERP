#!/usr/bin/env node
// @ts-check
/* =========================================================================
   Pomiar jakości rozpoznania na prawdziwych zdjęciach dokumentów.

   Użycie:  node tools/eval.mjs [--dir eval/real] [--provider auto|mock|anthropic] [--only <plik>]
   Wejście: <dir>/*.expected.json (wzorzec ręczny) + zdjęcie wskazane w polu "image" (ten sam katalog).
   Wyjście: tabela w konsoli + raport JSON w <dir>/reports/ (katalog ignorowany przez git).

   Narzędzie NICZEGO nie zapisuje w magazynie wyników testowych ani w ERP — wywołuje
   tylko provider i normalizację. Przy providerze Claude każde zdjęcie = jedno płatne wywołanie API.
   ========================================================================= */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, MODULE_ROOT } from "../src/config.mjs";
import { createProviders } from "../src/providers/index.mjs";
import { inspectImage } from "../src/image.mjs";
import { normalizeExtraction } from "../src/normalize.mjs";
import { scoreDocument, summarize } from "../src/evaluate.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const dir = resolve(MODULE_ROOT, arg("--dir", "eval/real"));
const only = arg("--only", null);
const { cfg, env } = loadConfig({ provider: /** @type {any} */ (arg("--provider", undefined)), maxSide: 12000 });
const { active } = createProviders(cfg, env);
const st = active.status();

if (!existsSync(dir)) { console.error(`Brak katalogu ${dir}.`); process.exit(1); }
const specs = readdirSync(dir).filter(f => f.endsWith(".expected.json") && (!only || f.includes(only))).sort();
if (!specs.length) { console.error(`Brak plików *.expected.json w ${dir}.`); process.exit(1); }

console.log(`Provider: ${st.label}${st.model ? " · " + st.model : ""}${st.simulated ? "  — UWAGA: mock nie wykonuje OCR, wynik nie mierzy jakości" : ""}`);
if (!st.configured) { console.error(st.reason); process.exit(2); }

const docs = [];
for (const f of specs) {
  const expected = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const imgPath = join(dir, expected.image);
  if (!existsSync(imgPath)) { console.log(`\n${f}: POMINIĘTO — brak zdjęcia ${expected.image} (zdjęcia nie są w repozytorium; skopiuj je do ${dir})`); continue; }
  const buf = readFileSync(imgPath);
  const img = inspectImage(buf, { maxBytes: 20 * 1024 * 1024, minSide: cfg.minSide, maxSide: 12000 });
  if (!img.ok) { console.log(`\n${f}: POMINIĘTO — ${img.error}`); continue; }
  try {
    const { raw, meta } = await active.analyze({ buffer: buf, mime: img.mime, sha256: img.sha256 });
    const result = normalizeExtraction(raw);
    const s = scoreDocument(expected, result);
    docs.push(Object.assign(s, { ms: meta.ms, usage: meta.usage || null, notes: result.notes }));
    console.log(`\n${expected.image}  typ: ${s.docTypeGot} (oczekiwano ${s.docTypeExpected}) ${s.docTypeCorrect ? "OK" : "BŁĄD"}  pola z dokumentu: ${s.present.correct}/${s.present.total}  brak zgadywania: ${s.absent.correct}/${s.absent.total}  ${meta.ms ?? "?"} ms`);
    for (const r of s.rows) {
      const mark = { correct: "  ok ", wrong: "  ✗  ", missed: "  ∅  ", hallucinated: "  !! ", uncertain: "  ?  " }[r.status];
      console.log(`${mark}${r.key.padEnd(15)} oczek.: ${String(r.expected ?? "null").padEnd(34)} jest: ${String(r.got ?? "null")}${r.confidence != null ? ` (${Math.round(r.confidence * 100)}%)` : ""}`);
    }
  } catch (e) {
    console.log(`\n${f}: BŁĄD providera — ${e instanceof Error ? e.message : e}`);
  }
}
const sum = summarize(docs);
console.log("\nPODSUMOWANIE", JSON.stringify(sum, null, 1));
console.log("Legenda: ok zgodne · ✗ inna wartość · ∅ pominięte (jest na dokumencie) · !! wpisane, choć na dokumencie brak · ? wzorzec niepewny");
const outDir = join(dir, "reports");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ provider: st, summary: sum, documents: docs }, null, 2));
console.log("Raport: " + out);

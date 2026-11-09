// Testy izolowanego magazynu wyników, korekt, kartotek ERP (odczyt) i konfiguracji
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanStore, isValidId, newId, StoreError } from "../src/store.mjs";
import { applyCorrection } from "../src/analyze.mjs";
import { normalizeExtraction } from "../src/normalize.mjs";
import { matchMasterData, similarity, simplify } from "../src/master-data.mjs";
import { loadMasterData } from "../src/master-data-file.mjs";
import { loadConfig, parseEnvFile, assertIsolatedDataDir, MODULE_ROOT } from "../src/config.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "scanner-test-"));
const fixture = JSON.parse(readFileSync(join(MODULE_ROOT, "samples", "fixtures", "wz-458-10-2026.json"), "utf8"));
const MASTER = join(MODULE_ROOT, "samples", "erp-master-data.sample.json");

function makeRecord(store) {
  return store.create({
    image: { buffer: Buffer.from("obraz"), mime: "image/png", ext: "png", width: 10, height: 10, sha256: "a".repeat(64), originalName: "wz.png" },
    provider: { name: "mock", simulated: true }, hintType: null,
    result: normalizeExtraction(fixture.raw), erpMatches: {}
  });
}

test("identyfikatory: format i ochrona przed path traversal", () => {
  assert.ok(isValidId(newId()));
  for (const bad of ["../x", "scan_..", "scan_abc_zzzzzzzz", "", null]) assert.equal(isValidId(bad), false);
  const s = new ScanStore(tmp());
  assert.throws(() => s.get("../../etc/passwd"), StoreError);
});

test("zapis rekordu: izolacja, zamrożony wynik AI, brak plików tymczasowych", () => {
  const dir = tmp();
  const s = new ScanStore(dir);
  const rec = makeRecord(s);
  assert.equal(rec.testOnly, true);
  assert.equal(rec.erpPosted, false);
  assert.equal(rec.rev, 1);
  assert.deepEqual(rec.aiResult, rec.result);
  const files = readdirSync(join(dir, "scans"));
  assert.ok(files.includes(`${rec.id}.json`) && files.includes(`${rec.id}.png`));
  assert.ok(!files.some(f => f.endsWith(".tmp")));
  assert.ok(readdirSync(dir).includes("README-TEST-DATA.txt"));
  assert.equal(s.list()[0].docNumber, null, "WZ nie odczytuje numeru");
  assert.equal(s.list()[0].docDate, "03.10.2026");
  assert.equal(s.list()[0].vehicleReg, "WI12345");
});

test("korekta: historia było/jest, źródło manual, rewizja i ochrona przed nadpisaniem", async () => {
  const s = new ScanStore(tmp());
  const md = loadMasterData(MASTER);
  const rec = makeRecord(s);
  const ctx = { store: s, masterData: md };
  const r2 = await applyCorrection(ctx, rec.id, { rev: 1, reviewer: "Adrian W.", fields: { docDate: "03.10.2026", vehicleReg: "WI 1234P", recipient: null } });
  assert.equal(r2.rev, 2);
  assert.equal(r2.corrections.length, 2, "data bez zmiany — brak wpisu");
  assert.deepEqual(r2.corrections.map(c => [c.field, c.was, c.now, c.by]), [["vehicleReg", "WI12345", "WI 1234P", "Adrian W."], ["recipient", "XYZ Sp. z o.o.", null, "Adrian W."]]);
  assert.equal(r2.result.fields.vehicleReg.source, "manual");
  assert.equal(r2.result.fields.vehicleReg.confidence, 1);
  assert.equal(r2.aiResult.fields.vehicleReg.value, "WI12345", "wynik AI nie jest nadpisywany");
  assert.ok(r2.result.checks.some(w => /odbiorcy/.test(w)), "po usunięciu odbiorcy — kontrola WZ");
  assert.equal(r2.erpPosted, false);
  await assert.rejects(applyCorrection(ctx, rec.id, { rev: 1, fields: { vehicleReg: "X" } }), e => e.status === 409);
  await assert.rejects(applyCorrection(ctx, rec.id, { rev: 2, fields: { driver: "X" } }), e => e.status === 400 && /nie jest odczytywane/.test(e.message));
  await assert.rejects(applyCorrection(ctx, rec.id, { rev: 2, fields: { hack: "x" } }), e => e.status === 400);
  await assert.rejects(applyCorrection(ctx, rec.id, { rev: 2, fields: { vehicleReg: 5 } }), e => e.status === 400);
  await assert.rejects(applyCorrection(ctx, rec.id, { rev: 2, docType: "FAKTURA" }), e => e.status === 400);
  const r3 = await applyCorrection(ctx, rec.id, { rev: 2, docType: "PZ", markReviewed: true });
  assert.equal(r3.result.docType.value, "PZ");
  assert.equal(r3.result.docType.source, "manual");
  assert.equal(r3.status, "REVIEWED");
  assert.equal(r3.result.fields.vehicleReg.value, "WI 1234P", "korekta ręczna zachowana po zmianie typu");
  assert.equal(r3.result.fields.recipient.value, null, "usunięty ręcznie odbiorca nie wraca z odczytu AI");
  const r4 = await applyCorrection(ctx, rec.id, { rev: 3, docType: "KWIT_WAGOWY" });
  assert.equal(r4.result.fields.driver.value, "Jan Kowalski", "pola nowego typu uzupełnione z pełnego odczytu AI");
  assert.equal(r4.result.fields.quantity.value, null, "ilość nie jest odczytywana na kwicie wagowym");
});

test("korekty równoległe: dokładnie jedna wygrywa (reszta 409)", async () => {
  const s = new ScanStore(tmp());
  const rec = makeRecord(s);
  const ctx = { store: s, masterData: null };
  const res = await Promise.allSettled([1, 2, 3].map(i => applyCorrection(ctx, rec.id, { rev: 1, fields: { vehicleReg: "SK 100" + i } })));
  assert.equal(res.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(res.filter(r => r.status === "rejected" && r.reason.status === 409).length, 2);
  assert.equal(s.get(rec.id).rev, 2);
});

test("usuwanie wyniku testowego usuwa JSON i obraz", async () => {
  const dir = tmp();
  const s = new ScanStore(dir);
  const rec = makeRecord(s);
  await s.remove(rec.id);
  assert.deepEqual(readdirSync(join(dir, "scans")), []);
  assert.throws(() => s.get(rec.id), e => e.status === 404);
});

test("kartoteki ERP: tylko odczyt wybranych kluczy i podpowiedzi dopasowania", () => {
  const before = statSync(MASTER).mtimeMs;
  const md = loadMasterData(MASTER);
  assert.ok(md && md.products.length === 7 && md.vehicles.length === 4);
  assert.ok(!("users" in md));
  const r = normalizeExtraction(JSON.parse(readFileSync(join(MODULE_ROOT, "samples", "fixtures", "kwit-wywozowy-3-202640017-0871.json"), "utf8")).raw);
  const m = matchMasterData(r.fields, md);
  assert.equal(m.forestDistrict.id, "pa_ndl_rr");
  assert.equal(m.forestRange.label, "Kuźnia — Nadleśnictwo Rudy Raciborskie");
  assert.equal(m.vehicleReg.id, "ve_scania");
  assert.equal(r.fields.forestDistrict.value, "PGL LP NADLEŚNICTWO RUDY RACIBORSKIE", "wartość odczytu bez zmian");
  assert.equal(m.forestDistrict.score, 1, "prefiks „PGL LP NADLEŚNICTWO” pomijany przy dopasowaniu");
  assert.equal(statSync(MASTER).mtimeMs, before, "plik kartotek nie jest modyfikowany");
  assert.equal(simplify("Usługi Leśne Drwal sp. z o.o."), "uslugi lesne drwal");
  assert.ok(similarity("Elektrociepłownia Zabrze SA", "Elektrociepłownia Zabrze S.A.") > 0.95);
  assert.ok(similarity("XYZ Sp. z o.o.", "Lander Agro") < 0.3);
  assert.deepEqual(matchMasterData(r.fields, null), {});
});

test("konfiguracja: env, izolacja katalogu danych, wymóg tokenu poza localhost", () => {
  assert.deepEqual(parseEnvFile("# k\nA=1\nB = \"x y\"\nC='z'\n bad line"), { A: "1", B: "x y", C: "z" });
  const erpDir = tmp(); writeFileSync(join(erpDir, "resinvest.sqlite"), "");
  assert.throws(() => assertIsolatedDataDir(erpDir), /ResInvest ERP/);
  const named = join(tmp(), "data-server"); mkdirSync(named);
  assert.throws(() => assertIsolatedDataDir(named), /ResInvest ERP/);
  assert.throws(() => new ScanStore(erpDir), /ResInvest ERP/);
  const { cfg } = loadConfig({ dataDir: tmp(), provider: "mock" });
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.anthropic.model, "claude-opus-5-5");
  assert.throws(() => loadConfig({ dataDir: tmp(), host: "0.0.0.0", accessToken: null }), /SCANNER_ACCESS_TOKEN/);
  assert.throws(() => loadConfig({ dataDir: tmp(), provider: /** @type {any} */ ("tesseract") }), /Nieznany provider/);
});

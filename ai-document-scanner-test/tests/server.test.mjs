// Testy API serwera testowego (provider mock i atrapa Claude) — bez sieci zewnętrznej
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScannerServer } from "../server/scanner-server.mjs";
import { loadConfig, MODULE_ROOT } from "../src/config.mjs";

const FAKE_KEY = "sk-ant-api03-NEVER-LEAK-THIS-KEY-0123456789";
const wz = readFileSync(join(MODULE_ROOT, "samples", "wz-458-10-2026.png"));
const dataDir = mkdtempSync(join(tmpdir(), "scanner-srv-"));
let base = "", server;
const logs = [];

before(async () => {
  const { cfg } = loadConfig({ dataDir, provider: "mock", rateLimitPerMinute: 8 });
  // klucz obecny w środowisku — nie może pojawić się w żadnej odpowiedzi ani logu
  ({ server } = createScannerServer({ cfg, env: { ANTHROPIC_API_KEY: FAKE_KEY }, log: l => logs.push(l) }));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));

const allBodies = [];
async function call(path, opts = {}) {
  const res = await fetch(base + path, opts);
  const text = await res.text();
  allBodies.push(text);
  let json = null; try { json = JSON.parse(text); } catch { /* nie JSON */ }
  return { res, json, text };
}
const scan = (body, type = "image/png", q = "") => call("/api/scan" + q, { method: "POST", body, headers: { "Content-Type": type } });

test("health i status: tryb testowy, brak połączenia z ERP, bez sekretów", async () => {
  const h = await call("/api/health");
  assert.equal(h.json.testOnly, true);
  assert.equal(h.json.erpConnected, false);
  const s = await call("/api/status");
  assert.equal(s.json.provider.name, "mock");
  assert.equal(s.json.provider.simulated, true);
  const claude = s.json.providers.find(p => p.name === "anthropic");
  assert.equal(claude.configured, true, "klucz wykryty…");
  assert.ok(!s.text.includes(FAKE_KEY), "…ale nie ujawniony");
  assert.equal(s.json.samples.length, 5);
  assert.equal(s.json.samples[0].label, "WZ");
  assert.equal(s.json.erpMasterData.loaded, true);
  assert.match(s.res.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(s.res.headers.get("x-content-type-options"), "nosniff");
});

test("skan WZ: wynik, pewności, ramki, dopasowanie ERP, zapis tylko w katalogu testowym", async () => {
  const r = await scan(wz, "image/png", "?hint=AUTO&name=wz.png");
  assert.equal(r.res.status, 201);
  const sc = r.json.scan;
  assert.equal(sc.testOnly, true);
  assert.equal(sc.erpPosted, false);
  assert.equal(sc.result.docType.value, "WZ");
  assert.equal(sc.result.fields.quantity.value, "68,40 MP");
  assert.deepEqual(sc.result.fields.quantity.normalized, { amount: 68.4, unit: "MP" });
  assert.equal(sc.result.fields.supplier.value, null);
  assert.equal(sc.erpMatches.driver, undefined, "kierowca nie jest odczytywany na WZ");
  assert.equal(sc.result.fields.docNumber.value, null, "numer nie jest odczytywany na WZ");
  assert.ok(sc.result.fields.vehicleReg.bbox.every(x => x >= 0 && x <= 1));
  assert.deepEqual(readdirSync(join(dataDir, "scans")).sort(), [`${sc.id}.json`, `${sc.id}.png`].sort());
  const img = await fetch(`${base}/api/scans/${sc.id}/image`);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await img.arrayBuffer()).length, wz.length);
  const exp = await fetch(`${base}/api/scans/${sc.id}/export`);
  assert.match(exp.headers.get("content-disposition"), /attachment/);
  assert.match(await exp.text(), /Wynik TESTOWY/);
});

test("korekta przez API i konflikt rewizji", async () => {
  const sc = (await scan(wz)).json.scan;
  const patch = (body, headers = { "Content-Type": "application/json" }) => call(`/api/scans/${sc.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  const ok = await patch({ rev: 1, reviewer: "Test", fields: { vehicleReg: "WI 1234P" } });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.json.scan.result.fields.vehicleReg.source, "manual");
  assert.equal(ok.json.scan.corrections[0].was, "WI12345");
  assert.equal((await patch({ rev: 1, fields: { vehicleReg: "X" } })).res.status, 409);
  const notWz = await patch({ rev: 2, fields: { driver: "Jan" } });
  assert.equal(notWz.res.status, 400, "pole spoza WZ odrzucone");
  assert.match(notWz.json.error, /nie jest odczytywane dla typu WZ/);
  assert.equal((await patch({ rev: 2 }, { "Content-Type": "text/plain" })).res.status, 415);
  const bad = await call(`/api/scans/${sc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{zły" });
  assert.equal(bad.res.status, 400);
  const list = await call("/api/scans");
  assert.ok(list.json.scans.some(s => s.id === sc.id && s.corrections === 1));
});

test("walidacja wejścia: format, typ, rozmiar, identyfikatory, ścieżki", async () => {
  assert.equal((await scan(Buffer.from("nie obraz"), "text/plain")).res.status, 415);
  assert.equal((await scan(Buffer.from("%PDF-1.7 dokument................"), "image/png")).res.status, 415);
  assert.equal((await scan(wz, "image/png", "?hint=FAKTURA")).res.status, 400);
  assert.equal((await scan(Buffer.alloc(9 * 1024 * 1024), "image/png")).res.status, 413);
  assert.equal((await call("/api/scans/..%2f..%2fetc")).res.status, 400);
  assert.equal((await call("/api/scans/scan_abcdef_00000000")).res.status, 404);
  assert.equal((await call("/../package.json")).res.status, 404);
  assert.equal((await call("/samples/fixtures/wz-458-10-2026.json")).res.status, 404, "tylko PNG z samples/");
  assert.equal((await call("/samples/wz-458-10-2026.png")).res.status, 200);
  assert.equal((await call("/nie-ma")).res.status, 404);
});

test("ochrona CSRF: zmiana danych z innej strony odrzucona", async () => {
  const r = await call("/api/scan", { method: "POST", body: wz, headers: { "Content-Type": "image/png", Origin: "https://evil.example" } });
  assert.equal(r.res.status, 403);
});

test("limit analiz na minutę", async () => {
  let last;
  for (let i = 0; i < 10; i++) last = await scan(Buffer.from("x"), "image/png");
  assert.equal(last.res.status, 429);
});

test("usuwanie wyniku testowego", async () => {
  const list = (await call("/api/scans")).json.scans;
  const id = list[list.length - 1].id;
  assert.equal((await call(`/api/scans/${id}`, { method: "DELETE" })).res.status, 200);
  assert.equal((await call(`/api/scans/${id}`)).res.status, 404);
});

test("żadna odpowiedź ani log nie zawiera klucza API", () => {
  for (const b of allBodies) assert.ok(!b.includes(FAKE_KEY));
  for (const l of logs) assert.ok(!l.includes(FAKE_KEY));
});

test("provider Claude (atrapa): błąd usługi → kod HTTP i komunikat bez szczegółów", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scanner-srv2-"));
  const { cfg } = loadConfig({ dataDir: dir, provider: "anthropic" });
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", stop_details: { category: null }, content: [] }) } } };
  const { server: s2 } = createScannerServer({ cfg, env: {}, deps: { anthropicClient: client }, log: () => {} });
  await new Promise(r => s2.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/scan`, { method: "POST", body: wz, headers: { "Content-Type": "image/png" } });
    const j = await res.json();
    assert.equal(res.status, 422);
    assert.equal(j.code, "REFUSAL");
    assert.deepEqual(readdirSync(join(dir, "scans")), [], "nieudana analiza niczego nie zapisuje");
  } finally { await new Promise(r => s2.close(r)); }
});

test("token dostępu: wymagany, gdy skonfigurowany", async () => {
  const { cfg } = loadConfig({ dataDir: mkdtempSync(join(tmpdir(), "scanner-srv3-")), provider: "mock", accessToken: "tajny-token-123" });
  const { server: s3 } = createScannerServer({ cfg, env: {}, log: () => {} });
  await new Promise(r => s3.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s3.address().port}`;
  try {
    assert.equal((await fetch(b + "/api/status")).status, 401);
    assert.equal((await fetch(b + "/api/status", { headers: { "X-Scanner-Token": "zly" } })).status, 401);
    assert.equal((await fetch(b + "/api/status", { headers: { "X-Scanner-Token": "tajny-token-123" } })).status, 200);
    const red = await fetch(b + "/?token=tajny-token-123", { redirect: "manual" });
    assert.equal(red.status, 302);
    assert.match(red.headers.get("set-cookie"), /scanner_token=.*HttpOnly; SameSite=Strict/);
  } finally { await new Promise(r => s3.close(r)); }
});

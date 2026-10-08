// Testy providerów (mock i Claude z atrapą klienta — bez sieci i bez kluczy) oraz kontroli obrazu
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createMockProvider } from "../src/providers/mock.mjs";
import { createAnthropicProvider, mapApiError, buildSystemPrompt, DEFAULT_MODEL } from "../src/providers/anthropic.mjs";
import { ProviderError } from "../src/providers/provider.mjs";
import { inspectImage, sniffMime, imageSize, sha256 } from "../src/image.mjs";
import { normalizeExtraction } from "../src/normalize.mjs";
import { FIELD_KEYS } from "../src/schema.mjs";
import { MODULE_ROOT } from "../src/config.mjs";

const SAMPLES = join(MODULE_ROOT, "samples");
const FIXTURES = join(SAMPLES, "fixtures");
const wz = readFileSync(join(SAMPLES, "wz-458-10-2026.png"));
const LIMITS = { maxBytes: 8 * 1024 * 1024, minSide: 400, maxSide: 8000 };

test("kontrola obrazu: sygnatura, wymiary, limity", () => {
  assert.equal(sniffMime(wz), "image/png");
  assert.deepEqual(imageSize(wz, "image/png"), { width: 1240, height: 1754 });
  const ok = inspectImage(wz, LIMITS);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.sha256, sha256(wz));
  const fake = Buffer.from("%PDF-1.7 to nie jest obraz....");
  const r = inspectImage(fake, LIMITS);
  assert.equal(!r.ok && r.status, 415);
  assert.equal(inspectImage(wz, Object.assign({}, LIMITS, { maxBytes: 1000 })).ok, false);
  const small = inspectImage(wz, Object.assign({}, LIMITS, { minSide: 2000 }));
  assert.equal(!small.ok && small.status, 422);
  // minimalny JPEG: SOI + SOF0 (wysokość 600, szerokość 800)
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffMime(jpg), "image/jpeg");
  assert.deepEqual(imageSize(jpg, "image/jpeg"), { width: 800, height: 600 });
});

test("mock: każdy przykład ma fixture zgodny z obrazem", async () => {
  const p = createMockProvider({ fixturesDir: FIXTURES });
  const pngs = readdirSync(SAMPLES).filter(f => f.endsWith(".png"));
  assert.equal(pngs.length, 5);
  for (const f of pngs) {
    const buf = readFileSync(join(SAMPLES, f));
    const { raw, meta } = await p.analyze({ buffer: buf, mime: "image/png", sha256: sha256(buf) });
    assert.equal(meta.simulated, true);
    assert.notEqual(raw.docType.value, "NIEZNANY", f);
    const r = normalizeExtraction(raw);
    for (const [k, fld] of Object.entries(r.fields)) if (fld.value != null) assert.ok(fld.bbox, `${f}: pole ${k} bez ramki`);
  }
});

test("mock: przykład WZ — tylko pola WZ (data, dostawca, odbiorca, nr rej., ilość)", async () => {
  const p = createMockProvider({ fixturesDir: FIXTURES });
  const { raw } = await p.analyze({ buffer: wz, mime: "image/png", sha256: sha256(wz) });
  const r = normalizeExtraction(raw);
  assert.equal(r.docType.value, "WZ"); assert.equal(r.docType.confidence, 0.98);
  const want = { docDate: ["03.10.2026", 0.99], recipient: ["XYZ Sp. z o.o.", 0.96], quantity: ["68,40 MP", 0.99], vehicleReg: ["WI12345", 0.91] };
  for (const [k, [v, c]] of Object.entries(want)) { assert.equal(r.fields[k].value, v, k); assert.equal(r.fields[k].confidence, c, k); }
  assert.equal(r.fields.supplier.value, null, "dostawcy nie ma na WZ → null");
  for (const k of ["docNumber", "product", "trailerReg", "driver", "netWeight"]) assert.equal(r.fields[k].value, null, `${k} nie jest odczytywane na WZ`);
  assert.equal(r.extracted.driver.value, "Jan Kowalski", "pełny odczyt zachowany na wypadek zmiany typu");
});

test("mock: kwit uszkodzony — netto null, podpowiedź bez wpisywania, nieczytelna godzina ostrzeżeniem", async () => {
  const p = createMockProvider({ fixturesDir: FIXTURES });
  const buf = readFileSync(join(SAMPLES, "kwit-wagowy-uszkodzony.png"));
  const r = normalizeExtraction((await p.analyze({ buffer: buf, mime: "image/png", sha256: sha256(buf) })).raw);
  assert.equal(r.fields.netWeight.value, null);
  assert.equal(r.fields.driver.value, null);
  assert.ok(r.hints.some(h => /NIE została wpisana/.test(h)));
  assert.equal(r.fields.time.confidence, 0.5);
  assert.ok(r.fields.time.warnings.length > 0);
});

test("mock: nieznane zdjęcie → NIEZNANY i same null (bez udawania OCR)", async () => {
  const p = createMockProvider({ fixturesDir: FIXTURES });
  const buf = Buffer.concat([wz, Buffer.from([0])]);
  const { raw } = await p.analyze({ buffer: buf, mime: "image/png", sha256: sha256(buf) });
  assert.equal(raw.docType.value, "NIEZNANY");
  assert.ok(FIELD_KEYS.every(k => raw.fields[k].value === null));
  assert.match(raw.notes, /nie wykonuje OCR/);
});

/** Atrapa klienta SDK: zapisuje żądanie, zwraca przygotowaną odpowiedź. */
function fakeClient(response) {
  const calls = [];
  return { calls, beta: { messages: { create: async (params, opts) => { calls.push({ params, opts }); if (response instanceof Error) throw response; return response; } } } };
}
const fixtureRaw = JSON.parse(readFileSync(join(FIXTURES, "wz-458-10-2026.json"), "utf8")).raw;

test("Claude: żądanie zawiera obraz, schemat JSON i fallback; wynik jest parsowany", async () => {
  const client = fakeClient({ model: DEFAULT_MODEL, stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(fixtureRaw) }], usage: { input_tokens: 1800, output_tokens: 900 } });
  const p = createAnthropicProvider({ client, effort: "high" });
  assert.equal(p.status().configured, true);
  const { raw, meta } = await p.analyze({ buffer: wz, mime: "image/png", sha256: sha256(wz), hintType: "WZ" });
  assert.equal(raw.docType.value, "WZ");
  assert.equal(meta.simulated, false);
  assert.deepEqual(meta.usage, { inputTokens: 1800, outputTokens: 900 });
  const { params } = client.calls[0];
  assert.equal(params.model, "claude-opus-5-5");
  assert.deepEqual(params.thinking, { type: "adaptive" });
  assert.equal(params.output_config.effort, "high");
  assert.equal(params.output_config.format.type, "json_schema");
  assert.deepEqual(params.output_config.format.schema.properties.fields.required, FIELD_KEYS);
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  const img = params.messages[0].content[0];
  assert.equal(img.type, "image");
  assert.equal(img.source.media_type, "image/png");
  assert.equal(img.source.data, wz.toString("base64"));
  assert.match(params.messages[0].content[1].text, /podpowiedź użytkownika\): WZ/);
  assert.match(params.system, /Nie zgaduj/);
  assert.match(params.system, /nagłówku kolumny/, "jednostka z nagłówka kolumny");
  assert.match(params.system, /KWIT_WYWOZOWY: Kwit: docNumber, docDate, forestDistrict, forestRange \| Transport: vehicleReg, quantity/);
  assert.match(params.system, /- WZ: Dokument: docDate, supplier, recipient \| Transport: vehicleReg, quantity/, "numeracja WZ ręczna — nie dla AI");
  assert.match(params.system, /- PZ: Dokument: docDate, supplier, recipient \| Transport: vehicleReg, quantity, netWeight/);
  assert.match(params.system, /Numeracja WZ, PZ i kwitu wagowego jest wpisywana ręcznie/);
  assert.match(params.system, /numer kwitu z góry dokumentu/);
  assert.match(params.system, /Znaki wodne aparatu/);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(buildSystemPrompt()), "instrukcja systemowa bez dat (stabilny cache)");
});

test("Claude: odmowa, ucięcie, zły JSON → czytelne błędy", async () => {
  const mk = res => createAnthropicProvider({ client: fakeClient(res) }).analyze({ buffer: wz, mime: "image/png", sha256: "x" });
  await assert.rejects(mk({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }), e => e instanceof ProviderError && e.code === "REFUSAL" && /cyber/.test(e.message));
  await assert.rejects(mk({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }), e => e.code === "TRUNCATED");
  await assert.rejects(mk({ stop_reason: "end_turn", content: [{ type: "text", text: "nie json" }] }), e => e.code === "BAD_JSON");
  await assert.rejects(mk({ stop_reason: "end_turn", content: [] }), e => e.code === "EMPTY");
});

test("Claude: bez klucza — nieskonfigurowany, brak wywołań sieci", async () => {
  const p = createAnthropicProvider({ apiKey: null });
  const st = p.status();
  assert.equal(st.configured, false);
  assert.match(st.reason, /ANTHROPIC_API_KEY/);
  await assert.rejects(p.analyze({ buffer: wz, mime: "image/png", sha256: "x" }), e => e.code === "NOT_CONFIGURED" && e.status === 503);
});

test("Claude: status nie ujawnia klucza", () => {
  const key = "sk-ant-api03-TESTKEY-123456789";
  const st = createAnthropicProvider({ apiKey: key }).status();
  assert.ok(!JSON.stringify(st).includes(key));
});

test("Claude: błędy SDK mapowane po klasach (od najbardziej szczegółowych)", () => {
  const sdk = { default: Anthropic };
  const headers = new Headers();
  assert.equal(mapApiError(new Anthropic.RateLimitError(429, {}, "rate", headers), sdk).code, "RATE_LIMIT");
  assert.equal(mapApiError(new Anthropic.AuthenticationError(401, {}, "auth", headers), sdk).code, "AUTH");
  assert.equal(mapApiError(new Anthropic.BadRequestError(400, {}, "bad", headers), sdk).code, "BAD_REQUEST");
  assert.equal(mapApiError(new Anthropic.InternalServerError(500, {}, "err", headers), sdk).code, "UPSTREAM");
  assert.equal(mapApiError(new Anthropic.APIConnectionTimeoutError(), sdk).code, "TIMEOUT");
  assert.equal(mapApiError(new Anthropic.APIConnectionError({ message: "x" }), sdk).code, "NETWORK");
  assert.equal(mapApiError(new Anthropic.APIUserAbortError(), sdk).code, "ABORTED");
  assert.equal(mapApiError(new Error("?"), sdk).code, "UNKNOWN");
  const e = mapApiError(new Anthropic.AuthenticationError(401, {}, "invalid x-api-key sk-ant-secret", headers), sdk);
  assert.ok(!e.message.includes("sk-ant"), "komunikat dla użytkownika bez szczegółów technicznych");
});

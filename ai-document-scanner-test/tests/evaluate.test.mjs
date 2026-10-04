// Testy oceny jakości (wzorzec vs wynik) i poprawek z prawdziwych dokumentów
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scoreDocument, summarize, matches, expectedField, compareKey } from "../src/evaluate.mjs";
import { normalizeExtraction } from "../src/normalize.mjs";
import { FIELD_KEYS } from "../src/schema.mjs";
import { loadMasterData, matchMasterData, integrationHints, warehouseName } from "../src/master-data.mjs";
import { MODULE_ROOT } from "../src/config.mjs";

const EVAL = join(MODULE_ROOT, "eval", "real");
const specs = readdirSync(EVAL).filter(f => f.endsWith(".expected.json")).map(f => JSON.parse(readFileSync(join(EVAL, f), "utf8")));

/** Wynik „providera” zbudowany ze wzorca (z możliwością podmiany pól). */
function resultFrom(spec, overrides = {}, docType = spec.docType) {
  const fields = Object.fromEntries(FIELD_KEYS.map(k => {
    const v = k in overrides ? overrides[k] : expectedField(spec.fields[k]).value;
    return [k, { value: v, confidence: v == null ? null : 0.9, bbox: null }];
  }));
  return normalizeExtraction({ docType: { value: docType, confidence: 0.95 }, fields });
}

test("wzorce prawdziwych dokumentów: tylko znane pola i typy", () => {
  assert.equal(specs.length, 3);
  for (const s of specs) {
    for (const k of Object.keys(s.fields)) assert.ok(FIELD_KEYS.includes(k), `${s.image}: nieznane pole ${k}`);
    assert.ok(["WZ", "KWIT_WYWOZOWY"].includes(s.docType));
  }
});

test("wynik identyczny ze wzorcem = 100% i pełna dyscyplina null", () => {
  for (const s of specs) {
    const r = scoreDocument(s, resultFrom(s));
    assert.equal(r.docTypeCorrect, true);
    assert.equal(r.presentAccuracy, 1, s.image + " " + JSON.stringify(r.rows.filter(x => x.status !== "correct" && x.status !== "uncertain")));
    assert.ok(r.nullDiscipline === 1 || r.nullDiscipline === null, "brak pól nieobecnych = null");
  }
});

test("wykrywa zgadywanie, pominięcia i błędne wartości", () => {
  const kwit = specs.find(s => s.docType === "KWIT_WYWOZOWY");
  const r = scoreDocument(kwit, resultFrom(kwit, { vehicleReg: null, quantity: "17,05 m3", forestRange: "Kuźnia" }));
  const st = Object.fromEntries(r.rows.map(x => [x.key, x.status]));
  assert.equal(st.vehicleReg, "missed");
  assert.equal(st.quantity, "wrong");
  assert.equal(st.forestRange, "wrong");
  assert.ok(r.presentAccuracy < 1);
  // WZ: odbiorcy nie ma na dokumencie, a provider go wpisał → zgadywanie
  const spec = { image: "x.jpg", docType: "WZ", fields: { docDate: "01.10.2026", vehicleReg: "SK 7H433", quantity: "60 mp" } };
  const z = scoreDocument(spec, resultFrom(spec, { recipient: "Elektrownia Łaziska" }));
  assert.equal(z.rows.find(x => x.key === "recipient").status, "hallucinated");
  assert.ok(z.nullDiscipline < 1);
});

test("oceniane są tylko pola typu dokumentu", () => {
  const kwit = specs.find(s => s.docType === "KWIT_WYWOZOWY");
  const r = scoreDocument(kwit, resultFrom(kwit));
  assert.deepEqual(r.rows.map(x => x.key).sort(), ["docNumber", "forestDistrict", "forestRange", "quantity", "vehicleReg"]);
  const wz = specs.find(s => s.image.startsWith("wz-zielona"));
  assert.deepEqual(scoreDocument(wz, resultFrom(wz)).rows.map(x => x.key).sort(), ["docDate", "quantity", "recipient", "vehicleReg"]);
});

test("porównanie po normalizacji i alternatywy", () => {
  assert.equal(compareKey("docDate", "27/03/2026"), compareKey("docDate", "27.03.2026 r."));
  assert.equal(compareKey("quantity", "62,60 mp"), compareKey("quantity", "62.6 MP"));
  assert.equal(compareKey("netWeight", "12950,00 kg"), compareKey("netWeight", "12,95 t"));
  assert.equal(compareKey("vehicleReg", "SK7H433"), compareKey("vehicleReg", "SK 7H433"));
  const exp = expectedField({ value: "PGL LP Nadleśnictwo Zawadzkie", alternatives: ["Nadleśnictwo Zawadzkie"] });
  assert.ok(matches("forestDistrict", "NADLEŚNICTWO ZAWADZKIE", exp));
  assert.ok(matches("forestDistrict", "PGL LP NADLESNICTWO ZAWADZKIE", exp), "wielkość liter i polskie znaki bez znaczenia");
  assert.ok(matches("recipient", "ResInvest Commodities PL S.A.", expectedField({ value: "ResInvest Commodities PL Spółka Akcyjna", alternatives: ["ResInvest Commodities PL S.A."] })));
  assert.ok(!matches("vehicleReg", "WND 3545F", expectedField("WND 3546F")), "jedna cyfra rej. inna = błąd");
  assert.ok(matches("supplier", null, expectedField({ value: null, alternatives: ["X"] })));
  assert.ok(matches("supplier", "X", expectedField({ value: null, alternatives: ["X"] })));
});

test("podsumowanie i kalibracja pewności", () => {
  const kwit = specs.find(s => s.docType === "KWIT_WYWOZOWY");
  const a = scoreDocument(kwit, resultFrom(kwit));
  const b = scoreDocument(kwit, resultFrom(kwit, { vehicleReg: "WND 3545F" }, "NIEZNANY"));
  const sum = summarize([a, b]);
  assert.equal(sum.documents, 2);
  assert.equal(sum.docTypeAccuracy, 0.5);
  assert.equal(sum.presentFieldAccuracy, 0.9, "9 z 10 pól z dokumentu");
  assert.equal(sum.avgConfidenceWrong, 0.9);
});

test("WZ z magazynem własnym jako odbiorcą → podpowiedź MM", () => {
  const md = loadMasterData(join(MODULE_ROOT, "samples", "erp-master-data.sample.json"));
  const wz = specs.find(s => s.image.startsWith("wz-zielona"));
  const r = resultFrom(wz);
  const m = matchMasterData(r.fields, md);
  assert.equal(m.recipient.kind, "warehouse");
  assert.equal(m.recipient.id, "wh_zab");
  assert.equal(r.fields.product.value, null, "towar nie jest odczytywany na WZ");
  assert.match(integrationHints("WZ", m)[0], /przesunięcie MM/);
  assert.deepEqual(integrationHints("PZ", m), []);
  assert.equal(warehouseName("RiC Magazyn Zabrze"), "zabrze");
  assert.equal(r.fields.docDate.normalized, "2026-08-27");
  assert.equal(r.fields.quantity.value, "62,60 MP");
  assert.equal(r.fields.vehicleReg.value, "PY 30536");
});

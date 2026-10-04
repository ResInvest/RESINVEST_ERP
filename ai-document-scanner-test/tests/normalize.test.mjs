// Testy normalizacji i walidacji odczytu
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlNumber, parseQuantity, parseDate, parseTime, normalizePlate, isPolishPlate, normalizeBbox,
  normalizeField, normalizeExtraction, crossCheck, applyTypeRules, isEmptyValue, canonicalUnit, isAmbiguousNumber, CAP_INVALID, CAP_UNUSUAL, averageConfidence
} from "../src/normalize.mjs";
import { FIELD_KEYS, extractionJsonSchema, fieldsFor, TYPE_SECTIONS } from "../src/schema.mjs";

const raw = (value, confidence = 0.9, bbox = null) => ({ value, confidence, bbox });

test("liczby w zapisie polskim", () => {
  assert.equal(parsePlNumber("68,40"), 68.4);
  assert.equal(parsePlNumber("1 234,5"), 1234.5);
  assert.equal(parsePlNumber("1\u00A0234,5"), 1234.5);
  assert.equal(parsePlNumber("1.234,5"), 1234.5);
  assert.equal(parsePlNumber("12.50"), 12.5);
  assert.equal(parsePlNumber("24 860"), 24860);
  assert.equal(parsePlNumber("1.250"), 1250, "kropka + 3 cyfry = separator tysięcy");
  assert.equal(parsePlNumber("0.952"), 0.952, "0.xxx to ułamek");
  assert.equal(parsePlNumber("-3,5"), -3.5);
  assert.equal(parsePlNumber("12,3,4"), null);
  assert.equal(parsePlNumber("abc"), null);
  assert.equal(parsePlNumber(""), null);
  assert.equal(parsePlNumber("1,23.4"), null);
  assert.ok(isAmbiguousNumber("1.250 t"));
  assert.ok(!isAmbiguousNumber("1 250 t"));
});

test("ilość z jednostką", () => {
  assert.deepEqual(parseQuantity("68,40 MP"), { amount: 68.4, unit: "MP", unitRaw: "MP" });
  assert.deepEqual(parseQuantity("24,5m3"), { amount: 24.5, unit: "m3", unitRaw: "m3" });
  assert.deepEqual(parseQuantity("31,20 m³"), { amount: 31.2, unit: "m3", unitRaw: "m³" });
  assert.deepEqual(parseQuantity("MP 12"), { amount: 12, unit: "MP", unitRaw: "MP" });
  assert.deepEqual(parseQuantity("39 860 kg"), { amount: 39860, unit: "kg", unitRaw: "kg" });
  assert.equal(parseQuantity("12,3 t").unit, "t");
  assert.equal(parseQuantity("brak").amount, null);
  assert.equal(canonicalUnit("m.p."), "MP");
  assert.equal(canonicalUnit("tony"), "t");
  assert.equal(canonicalUnit("Mg"), "t");
  assert.equal(canonicalUnit("litry"), null);
});

test("daty i godziny", () => {
  assert.equal(parseDate("03.10.2026"), "2026-10-03");
  assert.equal(parseDate("3.1.26"), "2026-01-03");
  assert.equal(parseDate("2026-10-02"), "2026-10-02");
  assert.equal(parseDate("02/10/2026"), "2026-10-02");
  assert.equal(parseDate("03.10.2026 r."), "2026-10-03");
  assert.equal(parseDate("31.02.2026"), null, "nie ma 31 lutego");
  assert.equal(parseDate("29.02.2028"), "2028-02-29");
  assert.equal(parseDate("13/13/2026"), null);
  assert.equal(parseDate("październik"), null);
  assert.equal(parseDate("27/03/2026 15:12:05"), "2026-03-27", "data z godziną (kwit wywozowy LP)");
  assert.equal(parseDate("27.08.26r."), "2026-08-27", "odręczna WZ");
  assert.equal(parseTime("7:40"), "07:40");
  assert.equal(parseTime("14.12"), "14:12");
  assert.equal(parseTime("07:05:31"), "07:05:31");
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("9:5?"), null);
});

test("numery rejestracyjne", () => {
  assert.equal(normalizePlate(" sgl-4t821 "), "SGL 4T821");
  assert.ok(isPolishPlate("WI12345"));
  assert.ok(isPolishPlate("SZA 12345"));
  assert.ok(isPolishPlate("SGL 2N44P"));
  assert.ok(!isPolishPlate("D-AB 1234"), "niemiecki — nietypowy");
});

test("ramki bbox", () => {
  assert.deepEqual(normalizeBbox([0.1, 0.2, 0.3, 0.25]), [0.1, 0.2, 0.3, 0.25]);
  assert.deepEqual(normalizeBbox([0.3, 0.25, 0.1, 0.2]), [0.1, 0.2, 0.3, 0.25], "odwrócone rogi");
  assert.deepEqual(normalizeBbox([-0.01, 0, 0.5, 1.02]), [0, 0, 0.5, 1], "lekkie wyjście poza zakres → przycięcie");
  assert.equal(normalizeBbox([10, 20, 300, 400]), null, "piksele zamiast 0..1 — odrzucone, nie zgadujemy skali");
  assert.equal(normalizeBbox([0.1, 0.1, 0.1, 0.5]), null, "zerowa szerokość");
  assert.equal(normalizeBbox([0.1, 0.2, 0.3]), null);
  assert.equal(normalizeBbox(null), null);
});

test("brak wartości = null, bez pewności i ramki", () => {
  for (const v of [null, "", "  ", "-", "—", "brak", "N/A", "nieczytelne"]) {
    const f = normalizeField("driver", raw(v, 0.9, [0.1, 0.1, 0.2, 0.2]));
    assert.equal(f.value, null, `„${v}”`);
    assert.equal(f.confidence, null);
    assert.equal(f.bbox, null);
  }
  assert.ok(isEmptyValue("  Brak "));
  assert.equal(normalizeField("driver", undefined).value, null);
});

test("pole data: normalizacja i limit pewności przy błędnym formacie", () => {
  const ok = normalizeField("docDate", raw("2026-10-03", 0.99));
  assert.equal(ok.value, "03.10.2026");
  assert.equal(ok.normalized, "2026-10-03");
  assert.equal(ok.confidence, 0.99);
  const bad = normalizeField("docDate", raw("32.10.2026", 0.97));
  assert.equal(bad.value, "32.10.2026", "wartość zostaje taka, jak odczytano");
  assert.equal(bad.normalized, null);
  assert.equal(bad.confidence, CAP_INVALID);
  assert.match(bad.warnings[0], /daty/);
});

test("pole ilość: brak jednostki nie jest uzupełniany", () => {
  const f = normalizeField("quantity", raw("68,40", 0.99));
  assert.deepEqual(f.normalized, { amount: 68.4, unit: null });
  assert.equal(f.value, "68,4");
  assert.equal(f.confidence, CAP_UNUSUAL);
  assert.ok(f.warnings.some(w => /Brak jednostki/.test(w)));
  const g = normalizeField("quantity", raw("68,40 MP", 0.99));
  assert.equal(g.value, "68,40 MP");
  assert.equal(g.confidence, 0.99);
  const neg = normalizeField("quantity", raw("0 MP", 0.9));
  assert.equal(neg.confidence, CAP_INVALID);
});

test("pole masa: kg / t i przeliczenie do kg tylko w normalized", () => {
  const kg = normalizeField("grossWeight", raw("39 860 kg", 0.98));
  assert.deepEqual(kg.normalized, { amount: 39860, unit: "kg", kg: 39860 });
  const t = normalizeField("netWeight", raw("24,44 t", 0.98));
  assert.equal(t.normalized.kg, 24440);
  assert.equal(t.value, "24,44 t");
  const bad = normalizeField("netWeight", raw("24 MP", 0.98));
  assert.equal(bad.normalized.unit, null);
  assert.equal(bad.confidence, CAP_INVALID);
});

test("pole nr rej.: ujednolicenie i ostrzeżenia", () => {
  const p = normalizeField("vehicleReg", raw("sza-12345", 0.95));
  assert.equal(p.value, "SZA 12345");
  assert.equal(p.confidence, 0.95);
  const foreign = normalizeField("vehicleReg", raw("D-AB 1234", 0.95));
  assert.equal(foreign.confidence, CAP_UNUSUAL);
  const notPlate = normalizeField("trailerReg", raw("Jan Kowalski", 0.9));
  assert.equal(notPlate.confidence, CAP_INVALID);
});

test("korekta ręczna: pewność 1, źródło manual, bez limitów", () => {
  const f = normalizeField("docDate", { value: "03.10.2026", confidence: null, bbox: [0.1, 0.1, 0.2, 0.12] }, "manual");
  assert.equal(f.source, "manual");
  assert.equal(f.confidence, 1);
  assert.deepEqual(f.bbox, [0.1, 0.1, 0.2, 0.12]);
});

test("kontrole krzyżowe nie uzupełniają danych", () => {
  const fields = Object.fromEntries(FIELD_KEYS.map(k => [k, normalizeField(k, null)]));
  fields.grossWeight = normalizeField("grossWeight", raw("40 120 kg"));
  fields.tareWeight = normalizeField("tareWeight", raw("14 980 kg"));
  let cc = crossCheck("KWIT_WAGOWY", fields);
  assert.equal(fields.netWeight.value, null, "netto pozostaje null");
  assert.match(cc.hints[0], /25\u00A0140 kg.*NIE została wpisana/);
  fields.netWeight = normalizeField("netWeight", raw("24 440 kg"));
  cc = crossCheck("KWIT_WAGOWY", fields);
  assert.match(cc.warnings[0], /różni się/);
  fields.netWeight = normalizeField("netWeight", raw("25 140 kg"));
  assert.equal(crossCheck("KWIT_WAGOWY", fields).warnings.length, 0);
  fields.vehicleReg = normalizeField("vehicleReg", raw("SZA 12345"));
  fields.trailerReg = normalizeField("trailerReg", raw("SZA12345"));
  assert.ok(crossCheck("KWIT_WAGOWY", fields).warnings.some(w => /naczepy/.test(w)));
  assert.ok(crossCheck("WZ", fields).warnings.some(w => /odbiorcy/.test(w)));
});

test("normalizacja całego wyniku i nieznany typ", () => {
  const fields = Object.fromEntries(FIELD_KEYS.map(k => [k, { value: null, confidence: null, bbox: null }]));
  fields.docNumber = raw("458/10/2026", 0.99);
  const r = normalizeExtraction({ docType: { value: "wz", confidence: 1.4 }, fields: Object.assign({ bogus: raw("x") }, fields) }, { hintType: "PZ" });
  assert.equal(r.docType.value, "WZ");
  assert.equal(r.docType.confidence, 1, "pewność przycięta do 1");
  assert.ok(r.warnings.some(w => /Wybrano typ PZ/.test(w)));
  assert.ok(r.warnings.some(w => /bogus/.test(w)));
  const u = normalizeExtraction({ docType: { value: "FAKTURA", confidence: 0.9 }, fields });
  assert.equal(u.docType.value, "NIEZNANY");
  assert.equal(u.docType.confidence, 0);
  assert.throws(() => normalizeExtraction(/** @type {any} */ ({ fields })), /nieoczekiwanym formacie/);
  assert.equal(averageConfidence(r.extracted), 0.99, "pełny odczyt zachowany w extracted");
  assert.equal(r.fields.docNumber.value, null, "WZ nie odczytuje numeru");
});

test("schemat JSON dla providera: wszystkie pola wymagane i bez dodatkowych", () => {
  const s = extractionJsonSchema();
  assert.deepEqual(s.properties.fields.required, FIELD_KEYS);
  assert.equal(s.properties.fields.additionalProperties, false);
  for (const k of FIELD_KEYS) {
    const f = s.properties.fields.properties[k];
    assert.deepEqual(f.required, ["value", "confidence", "bbox"]);
    assert.deepEqual(f.properties.value.type, ["string", "null"]);
  }
});

test("pola odczytywane dla typu (bez dodatkowych pól)", () => {
  assert.deepEqual(TYPE_SECTIONS.KWIT_WYWOZOWY, [
    { title: "Kwit", fields: ["docNumber", "forestDistrict", "forestRange"] },
    { title: "Transport", fields: ["vehicleReg", "quantity"] }
  ]);
  for (const t of ["WZ", "PZ"]) assert.deepEqual(fieldsFor(t), ["docDate", "supplier", "recipient", "vehicleReg", "quantity"]);
  assert.equal(fieldsFor("COŚ"), fieldsFor("NIEZNANY"));
  const all = Object.fromEntries(FIELD_KEYS.map(k => [k, normalizeField(k, null)]));
  all.docNumber = normalizeField("docNumber", raw("458/10/2026", 0.99));
  all.driver = normalizeField("driver", raw("Jan Kowalski", 0.8));
  all.quantity = normalizeField("quantity", raw("12 t", 0.95));
  const wz = applyTypeRules("WZ", all);
  assert.equal(wz.docNumber.value, null, "numer nie jest odczytywany na WZ");
  assert.equal(wz.driver.value, null);
  assert.equal(wz.quantity.value, "12,00 t");
  assert.equal(wz.quantity.confidence, 0.95, "t dozwolone na WZ");
  const kw = applyTypeRules("KWIT_WYWOZOWY", all);
  assert.equal(kw.docNumber.value, "458/10/2026");
  assert.equal(kw.quantity.confidence, CAP_UNUSUAL, "kwit wywozowy: oczekiwane m3");
  assert.match(kw.quantity.warnings.at(-1), /oczekiwano: m3/);
  assert.equal(all.quantity.warnings.length, 0, "oryginał bez zmian");
});

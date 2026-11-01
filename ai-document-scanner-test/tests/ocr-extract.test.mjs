// Testy odczytu pól z wyniku darmowego OCR (Tesseract) — strony OCR budowane ręcznie (deterministyczne)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFromOcr, detectType, mergeExtractions, matchLabel, valueAt, findDate, findPlate, fixDigits, norm,
  pageFromTesseract, wordConfidence, ID_CAP, FORM_CAP
} from "../src/ocr-extract.mjs";
import { normalizeExtraction } from "../src/normalize.mjs";

/**
 * Strona OCR z linii tekstu. Słowo z „~” na końcu ma niską pewność (20), z „!” — średnią (70); pozostałe 95.
 * @param {string[]} lines
 */
function page(lines, width = 1000, height = 2000) {
  let y = 10;
  return {
    width, height,
    lines: lines.map(text => {
      let x = 10;
      const words = text.split(/\s+/).filter(Boolean).map(t => {
        const conf = t.endsWith("~") ? 20 : t.endsWith("!") && t.length > 1 ? 70 : 95;
        const clean = t.replace(/[~]$/, "").replace(/(.)!$/, "$1");
        const w = { text: clean, conf, bbox: { x0: x, y0: y, x1: x + clean.length * 12, y1: y + 20 } };
        x += clean.length * 12 + 12;
        return w;
      });
      const line = { text: words.map(w => w.text).join(" "), conf: 90, bbox: { x0: 10, y0: y, x1: x, y1: y + 20 }, words };
      y += 30;
      return line;
    })
  };
}

const LP_KWIT = [
  "Kwit wywozowy",
  "nr 7/202636843/1019",
  "Nadleśnictwo : PGL LP NADLEŚNICTWO ZAWADZKIE",
  "Adres nadleśnictwa : STRZELECKA 6 ZAWADZKIE",
  "Nazwa leśnictwa : KOLONOWSKIE (R2)",
  "Klient : RESINVEST COMMODITIES PL SPÓŁKA AKCYJNA",
  "Data wystawienia : 27/03/2026 15:12:05",
  "Pozycja planu : 202636843",
  "Przewoźnik : Przewoźnik odbiorcy (1877)",
  "Nr rej. pojazdu : WND 3546F",
  "Wydano dnia : 27/03/2026 r.",
  "Lp Nazwa WOD Artykul Masa[m3]",
  "1 W2636853/2 SO M2 ZE 17,50",
  "Razem : 1 17,50",
  "Masy [m3] i ilości łączne wg artykułów",
  "SO/M2 / 17,50 / 1",
  "Waga drewna obliczona ... wynosi: 12950,00 kg"
];

test("tekst: normalizacja, pomyłki cyfr, daty i tablice", () => {
  assert.equal(norm("Nazwa leśnictwa:"), "nazwa lesnictwa");
  assert.equal(fixDigits("202b"), "2026");
  assert.equal(fixDigits("1O1l"), "1011");
  assert.equal(findDate("Wydano dnia :27/03/202b r,"), "27.03.2026", "„b” w roku = 6");
  assert.equal(findDate("Data wystawienia :77/03/2026"), null, "77. dzień — niepoprawna data, bez zgadywania");
  assert.equal(findDate("Nr 458/10/2026 · Data: 03.10.2026"), "03.10.2026", "numer dokumentu nie jest datą");
  assert.equal(findDate("Data: 2026-10-02 Godz.: 14:12"), "2026-10-02");
  assert.equal(findPlate("Nr raj. pojazdu WND 3546F"), "WND 3546F");
  assert.equal(findPlate("Środek transp. PY 30536 — Lander Agro"), "PY 30536");
  assert.equal(findPlate("NIP 2060002073"), null);
});

test("etykiety: tolerancja pomyłek OCR, ale „Wystawca” ≠ „Dostawca”", () => {
  const p = page(["Nadknictwo : PGL LP", "WYSTAWCA / MAGAZYN ODBIORCA", "Nr raj. pojazdu WND 3546F", "Data: 29.09.2026 Godz.: 9:50"]);
  assert.ok(matchLabel(p.lines[0], "Nadleśnictwo"), "3 pomyłki w długiej etykiecie");
  assert.equal(matchLabel(p.lines[1], "Dostawca"), null);
  assert.ok(matchLabel(p.lines[2], "Nr rej. pojazdu"));
  const d = valueAt(p, ["Data"]);
  assert.deepEqual(d && d.words.map(w => w.text), ["29.09.2026", "Godz.:", "9:50"], "dwukropek w dalszej części wartości nie przesuwa jej");
});

test("pole w ramce: wartość z następnej linii, tylko spod etykiety", () => {
  const p = page(["ODBIORCA", "XYZ Sp. z o.o."]);
  const v = valueAt(p, ["Odbiorca"]);
  assert.equal(v && v.words.map(w => w.text).join(" "), "XYZ Sp. z o.o.");
  assert.equal(valueAt(page(["DOSTAWCA MAGAZYN PRZYJMUJĄCY"]), ["Dostawca"]), null, "nagłówki kolumn to nie wartość");
});

test("typ dokumentu", () => {
  assert.equal(detectType(page(LP_KWIT)).value, "KWIT_WYWOZOWY");
  assert.equal(detectType(page(["Kwik wywozony", "Nadknictwo : X"])).value, "KWIT_WYWOZOWY", "tytuł z pomyłkami OCR");
  assert.equal(detectType(page(["KWIT WAGOWY", "BRUTTO: 40 120 kg"])).value, "KWIT_WAGOWY");
  assert.equal(detectType(page(["Odbiorca Wz", "Wydanie", "materiałów na zewn."])).value, "WZ");
  assert.equal(detectType(page(["PZ — PRZYJĘCIE ZEWNĘTRZNE"])).value, "PZ");
  assert.equal(detectType(page(["Faktura VAT nr 1/2026"])).value, "NIEZNANY");
});

test("kwit wywozowy LP: nr, data, nadleśnictwo, leśnictwo, nr rej., ilość m3", () => {
  const r = normalizeExtraction(extractFromOcr(page(LP_KWIT)));
  assert.equal(r.docType.value, "KWIT_WYWOZOWY");
  const v = k => r.fields[k].value;
  assert.equal(v("docNumber"), "7/202636843/1019");
  assert.equal(v("docDate"), "27.03.2026");
  assert.equal(v("forestDistrict"), "PGL LP NADLEŚNICTWO ZAWADZKIE");
  assert.equal(v("forestRange"), "KOLONOWSKIE (R2)");
  assert.equal(v("vehicleReg"), "WND 3546F");
  assert.equal(v("quantity"), "17,50 m3");
  assert.ok(r.fields.docNumber.confidence <= ID_CAP && r.fields.vehicleReg.confidence <= ID_CAP, "numery z OCR zawsze do sprawdzenia");
  assert.ok(r.fields.quantity.bbox && r.fields.quantity.bbox[1] > 0.2, "ramka z prawdziwych współrzędnych słów");
  assert.equal(r.fields.recipient.value, null, "klient nie jest polem kwitu wywozowego");
});

test("kwit wywozowy: błędy OCR — niepewna końcówka numeru, data z drugiej linii", () => {
  const lines = LP_KWIT.map(l => l.replace("nr 7/202636843/1019", "mr 7/202636843/10V9").replace("27/03/2026 15:12:05", "77/03/2026 151205").replace("27/03/2026 r.", "27/03/202b r,"));
  const r = normalizeExtraction(extractFromOcr(page(lines)));
  assert.equal(r.fields.docNumber.value, "7/202636843/10V9");
  assert.ok(r.fields.docNumber.confidence < 0.5, "litera w części liczbowej → niska pewność");
  assert.equal(r.fields.docDate.value, "27.03.2026", "„Data wystawienia” niepoprawna → „Wydano dnia”");
});

test("kwit wywozowy: słowa o niskiej pewności OCR → pole puste", () => {
  const lines = LP_KWIT.map(l => l.replace("KOLONOWSKIE (R2)", "koi~ ONOWSKIE~ (RZ)~"));
  const r = normalizeExtraction(extractFromOcr(page(lines)));
  assert.equal(r.fields.forestRange.value, null);
});

test("WZ: numer ręcznie, data, odbiorca, nr rej., ilość MP; pewność formularza ograniczona", () => {
  const p = page(["WZ — WYDANIE ZEWNĘTRZNE", "Nr 458/10/2026 · Data wystawienia: 03.10.2026", "ODBIORCA", "XYZ Sp. z o.o.", "Zrębka drzewna MP 68,40 MP", "Samochód: WI12345 Naczepa: W12345"]);
  const r = normalizeExtraction(extractFromOcr(p));
  assert.equal(r.docType.value, "WZ");
  assert.equal(r.fields.docNumber.value, null, "numeracja WZ ręczna");
  assert.equal(r.fields.docDate.value, "03.10.2026");
  assert.equal(r.fields.recipient.value, "XYZ Sp. z o.o.");
  assert.equal(r.fields.vehicleReg.value, "WI 12345");
  assert.equal(r.fields.quantity.value, "68,40 MP");
  for (const k of ["docDate", "recipient", "vehicleReg", "quantity"]) assert.ok(r.fields[k].confidence <= FORM_CAP, k);
});

test("WZ: szum pisma ręcznego nie jest wpisywany", () => {
  const p = page(["Wydanie materiałów na zewn.", "Środek transp.", "DY! 30536! — laude~", "Data wysyłki 19.0b.1o~"]);
  const r = normalizeExtraction(extractFromOcr(p));
  assert.equal(r.fields.vehicleReg.value, null, "pewność 70 < próg formularza");
  assert.equal(r.fields.docDate.value, null);
});

test("PZ: tony obok MP → osobne pole; same tony → ilość", () => {
  const both = normalizeExtraction(extractFromOcr(page(["PZ — PRZYJĘCIE ZEWNĘTRZNE", "Dostawca: Lander Agro", "Zrębka 62,60 mp 20,5 t", "Nr rej.: PY 30536"])));
  assert.equal(both.fields.quantity.value, "62,60 MP");
  assert.equal(both.fields.netWeight.value, "20,50 t");
  assert.equal(both.fields.supplier.value, "Lander Agro");
  const onlyT = normalizeExtraction(extractFromOcr(page(["PZ — PRZYJĘCIE ZEWNĘTRZNE", "Zrębka 20,5 t"])));
  assert.equal(onlyT.fields.quantity.value, "20,50 t");
  assert.equal(onlyT.fields.netWeight.value, null);
});

test("kwit wagowy: numer ręcznie, data ISO, godzina, masy", () => {
  const p = page(["KWIT WAGOWY", "Nr kwitu: 2026/10/0387", "Data: 2026-10-02 Godz.: 14:12", "Dostawca: ResInvest Commodities", "Odbiorca: Elektrociepłownia Zabrze S.A.", "Towar: Zrębka drzewna", "Pojazd: SZA 12345", "Naczepa: SZA 5521N", "BRUTTO: 39 860 kg", "TARA: 15 420 kg", "NETTO: 24 440 kg"]);
  const r = normalizeExtraction(extractFromOcr(p));
  assert.equal(r.fields.docNumber.value, null, "numeracja kwitu wagowego ręczna");
  assert.equal(r.fields.docDate.value, "02.10.2026");
  assert.equal(r.fields.time.value, "14:12");
  assert.equal(r.fields.recipient.value, "Elektrociepłownia Zabrze S.A.");
  assert.equal(r.fields.grossWeight.value, "39 860 kg".replace(" ", " "));
  assert.equal(r.fields.netWeight.normalized.kg, 24440);
  assert.equal(r.fields.vehicleReg.value, "SZA 12345");
  assert.equal(r.fields.trailerReg.value, "SZA 5521N");
  assert.deepEqual(r.checks, [], "netto = brutto − tara");
});

test("typ wybrany przez użytkownika ma pierwszeństwo", () => {
  const raw = extractFromOcr(page(["Faktura", "Dostawca: Lander Agro"]), { hintType: "PZ" });
  assert.equal(raw.docType.value, "PZ");
  assert.equal(raw.docType.confidence, 1);
  assert.equal(raw.fields.supplier.value, "Lander Agro");
});

test("dwa przebiegi: zgodne ↑, rozbieżne → ostrzeżenie i niska pewność, formularz wymaga zgodności", () => {
  const A = extractFromOcr(page(LP_KWIT));
  const B = extractFromOcr(page(LP_KWIT.map(l => l.replace("WND 3546F", "WND 3646F").replace("27/03/2026 15:12:05", "x").replace("27/03/2026 r.", "x"))));
  const m = normalizeExtraction(mergeExtractions(A, B));
  assert.equal(m.fields.quantity.value, "17,50 m3");
  assert.ok(m.fields.quantity.confidence >= A.fields.quantity.confidence, "zgodny odczyt nie traci pewności");
  assert.ok(m.fields.vehicleReg.confidence <= 0.5);
  assert.match(m.fields.vehicleReg.warnings[0], /Dwa odczyty OCR różnią się/);
  assert.equal(m.fields.docDate.value, "27.03.2026", "odczyt tylko w jednym przebiegu zostaje (kwit drukowany)…");
  assert.ok(m.fields.docDate.confidence < A.fields.docDate.confidence, "…z niższą pewnością");
  assert.ok(m.fields.docNumber.confidence <= ID_CAP);
  const wzA = extractFromOcr(page(["WZ — WYDANIE ZEWNĘTRZNE", "Samochód: WI12345"]));
  const wzB = extractFromOcr(page(["WZ — WYDANIE ZEWNĘTRZNE", "Samochód: ~"]));
  assert.equal(mergeExtractions(wzA, wzB).fields.vehicleReg.value, null, "WZ: wartość z jednego przebiegu = szum");
});

test("Tesseract → strona OCR; pewność słowa z pewności znaków", () => {
  assert.equal(wordConfidence({ confidence: 0, symbols: [{ confidence: 71 }, { confidence: 98 }, { confidence: 98 }] }), Math.round(0.6 * (267 / 3) + 0.4 * 71));
  assert.equal(wordConfidence({ confidence: 64 }), 64);
  const pg = pageFromTesseract({ blocks: [{ paragraphs: [{ lines: [{ text: "Nr rej. WND 3546F\n", confidence: 80, bbox: { x0: 0, y0: 0, x1: 9, y1: 9 }, words: [{ text: "WND", confidence: 0, bbox: { x0: 1, y0: 1, x1: 2, y1: 2 }, symbols: [{ confidence: 90 }] }] }] }] }] }, 100, 200);
  assert.equal(pg.lines[0].text, "Nr rej. WND 3546F");
  assert.equal(pg.lines[0].words[0].conf, 90);
});

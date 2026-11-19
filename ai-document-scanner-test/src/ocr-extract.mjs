// @ts-check
/* =========================================================================
   AI Document Scanner Test — odczyt pól z wyniku darmowego OCR (Tesseract)

   Wejście: strona OCR — linie tekstu ze słowami, pewnością (0–100) i ramkami w pikselach.
   Wyjście: RawExtraction (ten sam format co provider AI) → dalej wspólna normalizacja.

   Zasady:
   * pole wypełniane tylko wtedy, gdy na dokumencie jest etykieta / wzorzec, a słowa
     wartości mają wystarczającą pewność OCR — inaczej null (bez zgadywania),
   * pewność pola = średnia pewność słów wartości × współczynnik dopasowania etykiety,
   * ramka pola = suma ramek słów wartości (prawdziwe współrzędne z OCR),
   * pola ręczne (numeracja WZ / PZ / kwitu wagowego) nie są odczytywane,
   * pismo odręczne Tesseract czyta słabo — takie pola zwykle zostają puste do wpisania.
   ========================================================================= */
import { FIELD_KEYS } from "./schema.mjs";
import { parseDate, isPolishPlate, normalizePlate } from "./normalize.mjs";

/**
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box
 * @typedef {{ text: string, conf: number, bbox: Box }} OcrWord
 * @typedef {{ text: string, conf: number, bbox: Box, words: OcrWord[] }} OcrLine
 * @typedef {{ width: number, height: number, lines: OcrLine[] }} OcrPage
 * @typedef {{ value: string|null, confidence: number|null, bbox: number[]|null }} RawField
 */

/** Górna granica pewności pól z formularzy WZ / PZ (pismo ręczne) — zawsze do sprawdzenia. */
export const FORM_CAP = 0.7;

/** Górna granica pewności numerów odczytanych przez OCR (brak możliwości sprawdzenia cyfr). */
export const ID_CAP = 0.85;

/** Minimalna średnia pewność OCR słów wartości na formularzach WZ / PZ (pismo ręczne → dużo szumu). */
export const MIN_FORM_CONF = 78;

/** Minimalna średnia pewność OCR słów wartości (0–100). Poniżej — pole puste. */
export const MIN_WORD_CONF = 55;

/* ------------------------------------------------------------------ */
/* Tekst                                                               */
/* ------------------------------------------------------------------ */

/** Małe litery, bez polskich znaków i interpunkcji — do porównań etykiet. */
export function norm(s) {
  return String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Odległość Levenshteina (krótkie teksty etykiet). */
export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Typowe pomyłki OCR w ciągach cyfr (tylko w kontekście liczb / dat). */
const DIGIT_FIX = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", "|": "1", i: "1", "!": "1", Z: "2", z: "2", S: "5", s: "5", b: "6", G: "6", B: "8", g: "9", q: "9" };
export function fixDigits(s) {
  return String(s).replace(/[OoQDIl|i!ZzSsbGBgq]/g, ch => DIGIT_FIX[ch] || ch);
}

/* ------------------------------------------------------------------ */
/* Słowa → pole                                                        */
/* ------------------------------------------------------------------ */

const strip = s => String(s).replace(/^[\s:;.,|_'"“”‘’=—–-]+|[\s:;,|_'"“”‘’=—–-]+$/g, "");

/** @param {OcrWord[]} words @param {OcrPage} page */
function unionBox(words, page) {
  if (!words.length || !page.width || !page.height) return null;
  const x0 = Math.min(...words.map(w => w.bbox.x0)), y0 = Math.min(...words.map(w => w.bbox.y0));
  const x1 = Math.max(...words.map(w => w.bbox.x1)), y1 = Math.max(...words.map(w => w.bbox.y1));
  const r = v => Math.round(v * 10000) / 10000;
  return [r(x0 / page.width), r(y0 / page.height), r(x1 / page.width), r(y1 / page.height)];
}

/**
 * Pole z listy słów: wartość, pewność (średnia OCR × współczynnik), ramka.
 * @param {OcrWord[]} words @param {OcrPage} page @param {{ factor?: number, value?: string, minConf?: number }} [o]
 * @returns {RawField}
 */
export function fieldFromWords(words, page, o = {}) {
  const ws = words.filter(w => strip(w.text));
  if (!ws.length) return { value: null, confidence: null, bbox: null };
  const mean = ws.reduce((a, w) => a + (Number(w.conf) || 0), 0) / ws.length;
  if (mean < (o.minConf ?? MIN_WORD_CONF)) return { value: null, confidence: null, bbox: null };
  const value = o.value != null ? o.value : strip(ws.map(w => w.text).join(" "));
  if (!value) return { value: null, confidence: null, bbox: null };
  return { value, confidence: Math.round(Math.min(1, mean / 100 * (o.factor ?? 1)) * 1000) / 1000, bbox: unionBox(ws, page) };
}

/** @returns {RawField} */
const EMPTY = () => ({ value: null, confidence: null, bbox: null });

/* ------------------------------------------------------------------ */
/* Etykiety                                                            */
/* ------------------------------------------------------------------ */

/**
 * Czy linia zaczyna się od etykiety (tolerancja pomyłek OCR)? Zwraca liczbę słów etykiety i jakość dopasowania.
 * @param {OcrLine} line @param {string} label
 * @returns {{ words: number, quality: number }|null}
 */
export function matchLabel(line, label) {
  const lw = norm(label).split(" ");
  const words = line.words.map(w => norm(w.text)).filter((w, i) => w || i > 0);
  // pomiń drobne śmieci na początku linii („|”, „p”)
  for (let skip = 0; skip <= 1; skip++) {
    const cand = words.slice(skip, skip + lw.length).join(" ");
    if (!cand) continue;
    const target = lw.join(" ");
    const d = lev(cand.slice(0, target.length + 2), target);
    // krótkie etykiety: najwyżej 1 pomyłka (inaczej „Wystawca” ≈ „Dostawca”)
    const tol = target.length <= 8 ? 1 : Math.floor(target.length * 0.25);
    if (d <= tol) return { words: skip + lw.length, quality: d === 0 ? 1 : 1 - d / (target.length * 1.5) };
  }
  return null;
}

/**
 * Słowa wartości pod etykietą (układ „pole w ramce”): z następnej linii tylko słowa zaczynające się
 * nie wcześniej niż etykieta, do pierwszej dużej przerwy (kolejna kolumna formularza).
 * @param {OcrPage} page @param {OcrWord} labelWord @param {OcrLine} next
 */
function belowLabel(page, labelWord, next) {
  const x0 = labelWord ? labelWord.bbox.x0 - page.width * 0.02 : -Infinity;
  const ws = next.words.filter(w => strip(w.text) && w.bbox.x0 >= x0);
  const out = [];
  for (const w of ws) {
    if (out.length && w.bbox.x0 - out[out.length - 1].bbox.x1 > page.width * 0.06) break;
    out.push(w);
  }
  return out;
}

/**
 * Wartość przy etykiecie: słowa po etykiecie (po dwukropku), a gdy pusto — następna linia (układ „pole nad wartością”).
 * @param {OcrPage} page @param {string[]} labels
 * @returns {{ words: OcrWord[], quality: number, line: number }|null}
 */
export function valueAt(page, labels) {
  for (let i = 0; i < page.lines.length; i++) {
    const line = page.lines[i];
    for (const label of labels) {
      const m = matchLabel(line, label);
      if (!m) continue;
      let rest = line.words.slice(m.words);
      // dwukropek po etykiecie: osobny znak („: wartość”) albo sklejony z wartością („:wartość”) —
      // dalsze dwukropki (np. „Godz.: 9:50”) należą już do wartości
      if (rest[0] && /^[:;]/.test(rest[0].text)) {
        const after = rest[0].text.replace(/^[:;]+/, "");
        rest = (after ? [{ ...rest[0], text: after }] : []).concat(rest.slice(1));
      }
      rest = rest.filter(w => strip(w.text));
      if (rest.length && LABEL_WORDS.test(norm(rest.map(w => w.text).join(" ")))) rest = [];
      if (!rest.length && page.lines[i + 1]) rest = belowLabel(page, line.words[Math.max(0, m.words - 1)], page.lines[i + 1]);
      if (rest.length) return { words: rest, quality: m.quality, line: i };
    }
  }
  return null;
}

/** Wartość złożona wyłącznie z innych etykiet formularza (np. „MAGAZYN ODBIORCA”) — nie jest wartością. */
const LABEL_WORDS = /^(?:(?:odbiorca|dostawca|wystawca|magazyn|przyjmujacy|wydajacy|nabywca|sprzedawca|przeznaczenie|data|nr|numer|lesnictwo|nadlesnictwo|transport|kierowca|symbol|regon|nip)\s*)+$/;

/* ------------------------------------------------------------------ */
/* Wzorce wartości                                                     */
/* ------------------------------------------------------------------ */

const DATE_ONLY_RE = /([\dOoIlZzSsbB]{1,2})\s*[./-]\s*([\dOoIlZzSsbB]{1,2})\s*[./-]\s*([\dOoIlZzSsbB]{4}|\d{2})/;

/** Data z tekstu (z poprawą pomyłek OCR w cyfrach); zwraca tekst daty albo null. */
export function findDate(text) {
  const iso = String(text).match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso && parseDate(iso[0])) return iso[0];
  // nie wewnątrz numeru („458/10/2026” to nie data) — przed dniem nie może stać cyfra ani „/”
  for (const m of String(text).matchAll(new RegExp("(?<![\\d/])" + DATE_ONLY_RE.source, "g"))) {
    const t = `${fixDigits(m[1])}.${fixDigits(m[2])}.${fixDigits(m[3])}`;
    if (parseDate(t)) return t;
  }
  return null;
}

/** Słowa obejmujące fragment tekstu linii (do pewności i ramki). */
function wordsCovering(line, fragment) {
  const f = norm(fragment).split(" ").filter(Boolean);
  if (!f.length) return [];
  const ws = line.words;
  for (let i = 0; i < ws.length; i++) {
    const out = [];
    let k = 0;
    for (let j = i; j < ws.length && k < f.length; j++) {
      const wn = norm(ws[j].text);
      if (!wn) continue;
      if (f.slice(k).join("").startsWith(wn.replace(/ /g, "")) || wn.includes(f[k])) { out.push(ws[j]); k += Math.max(1, wn.split(" ").length); }
      else break;
    }
    if (out.length) return out;
  }
  return [];
}

const PLATE_RE = /\b([A-Z]{2,3})\s?([0-9][0-9A-Z]{2,4}|[A-Z0-9]{4,5})\b/g;

/** Pierwszy numer rejestracyjny w formacie polskim z linii. */
export function findPlate(text) {
  for (const m of String(text).toUpperCase().matchAll(PLATE_RE)) {
    const p = normalizePlate(`${m[1]} ${m[2]}`);
    if (isPolishPlate(p) && /\d/.test(m[2]) && !/^(NR|KW|WZ|PZ|NIP|TEL|UL)$/.test(m[1])) return p;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Typ dokumentu                                                       */
/* ------------------------------------------------------------------ */

/** @param {OcrPage} page @returns {{ value: string, confidence: number, evidence: string }} */
export function detectType(page) {
  const lines = page.lines.map(l => norm(l.text));
  const all = " " + lines.join(" \n ") + " ";
  const top = lines.slice(0, Math.max(4, Math.ceil(lines.length * 0.25))).join(" ");
  const fuzzyIn = (txt, phrase, tol) => {
    const t = txt.split(" "), p = phrase.split(" ");
    for (let i = 0; i + p.length <= t.length; i++) if (lev(t.slice(i, i + p.length).join(" "), phrase) <= tol) return true;
    return false;
  };
  if (fuzzyIn(top, "kwit wywozowy", 3)) return { value: "KWIT_WYWOZOWY", confidence: 0.95, evidence: "Tytuł „Kwit wywozowy”." };
  if (fuzzyIn(top, "kwit wagowy", 2)) return { value: "KWIT_WAGOWY", confidence: 0.95, evidence: "Tytuł „Kwit wagowy”." };
  const forest = ["nadlesnictwo", "nazwa lesnictwa", "wydano dnia", "nr rej pojazdu", "rodzaj ciecia"].filter(p => fuzzyIn(all, p, 2)).length;
  if (forest >= 2) return { value: "KWIT_WYWOZOWY", confidence: 0.8, evidence: "Pola kwitu wywozowego (nadleśnictwo, leśnictwo, nr rej. pojazdu)." };
  if (/\bbrutto\b/.test(all) && /\btara\b/.test(all)) return { value: "KWIT_WAGOWY", confidence: 0.8, evidence: "Pola brutto / tara." };
  // nazwa dokumentu (3 pkt) waży więcej niż samo oznaczenie „WZ” / „PZ” (1 pkt — łatwo o szum OCR)
  // nazwa dokumentu (3 pkt) waży więcej niż samo słowo „Wydanie” (2 pkt) i oznaczenie „WZ” (1 pkt — łatwo o szum OCR)
  const score = (code, phrases, word) => (new RegExp(` ${code} `).test(all) ? 1 : 0)
    + (phrases.some(p => fuzzyIn(all, p, 3)) ? 3 : fuzzyIn(all, word, 1) ? 2 : 0);
  const wz = score("wz", ["wydanie zewnetrzne", "wydanie materialow", "wydanie materialu", "wydanie towaru"], "wydanie")
    + (fuzzyIn(all, "na zewn", 1) || fuzzyIn(all, "na zewnatrz", 2) ? 2 : 0); // „Wydanie … na zewnątrz”
  const pz = score("pz", ["przyjecie zewnetrzne", "przyjecie materialow", "przyjecie materialu", "przyjecie towaru"], "przyjecie");
  if (wz > pz && wz >= 3) return { value: "WZ", confidence: wz >= 4 ? 0.95 : 0.85, evidence: "Nagłówek „Wydanie …” (WZ)." };
  if (pz > wz && pz >= 3) return { value: "PZ", confidence: pz >= 4 ? 0.95 : 0.85, evidence: "Nagłówek „Przyjęcie …” (PZ)." };
  return { value: "NIEZNANY", confidence: 0.3, evidence: "Nie znaleziono nagłówka znanego dokumentu." };
}

/* ------------------------------------------------------------------ */
/* Ekstrakcja pól                                                      */
/* ------------------------------------------------------------------ */

/** Pole z wartości przy etykiecie. */
function labeled(page, labels, factor = 1) {
  const v = valueAt(page, labels);
  return v ? fieldFromWords(v.words, page, { factor: factor * v.quality }) : EMPTY();
}

/** Data przy etykiecie (pierwsza poprawna z listy etykiet). */
function labeledDate(page, labelSets) {
  for (const labels of labelSets) {
    const v = valueAt(page, labels);
    if (!v) continue;
    const text = v.words.map(w => w.text).join(" ");
    const d = findDate(text);
    if (!d) continue;
    const ws = v.words.filter(w => DATE_ONLY_RE.test(w.text) || /\d/.test(w.text)).slice(0, 3);
    const fixed = fixDigits(text.match(DATE_ONLY_RE)?.[0] || "") !== (text.match(DATE_ONLY_RE)?.[0] || "");
    const f = fieldFromWords(ws.length ? ws : v.words, page, { value: d, factor: v.quality * (fixed ? 0.85 : 1) });
    if (f.value) return f;
  }
  return EMPTY();
}

/**
 * Numery (dokumentu, rejestracyjne) nie mają sumy kontrolnej — pojedyncza pomylona cyfra jest
 * niewykrywalna, więc odczyt OCR nigdy nie jest „pewny” (najwyżej ID_CAP — kolor „do sprawdzenia”).
 * @param {Record<string, RawField>} fields
 */
function capIds(fields) {
  for (const k of ["docNumber", "vehicleReg", "trailerReg"]) if (fields[k] && fields[k].confidence != null) fields[k].confidence = Math.min(/** @type {number} */ (fields[k].confidence), ID_CAP);
}

const isForm = type => type !== "KWIT_WYWOZOWY" && type !== "KWIT_WAGOWY";

/** @param {OcrPage} page */
function extractKwitWywozowy(page) {
  /** @type {Record<string, RawField>} */
  const f = {};
  // nr kwitu — u góry dokumentu: „nr 7/202636843/1019”
  f.docNumber = EMPTY();
  const topN = Math.max(5, Math.ceil(page.lines.length * 0.25));
  for (const line of page.lines.slice(0, topN)) {
    const m = line.text.match(/(\d{1,3})\s*\/\s*(\d{6,})\s*\/\s*([0-9A-Za-z|]{1,6})/) || line.text.match(/\bnr\.?\s*[:.]?\s*([A-Z]{0,3}\s?\d[\d/ -]{3,})/i);
    if (!m) continue;
    const raw = m[0].replace(/^nr\.?\s*[:.]?\s*/i, "").trim();
    const fixed = raw.replace(/[0-9A-Za-z|]+$/, t => (/\d/.test(t) ? fixDigits(t) : t));
    const ws = wordsCovering(line, raw);
    const doubtful = /[A-Za-z|]/.test(fixed.split("/").pop() || "") && /\//.test(fixed);
    f.docNumber = fieldFromWords(ws.length ? ws : line.words, page, { value: fixed, factor: doubtful ? 0.45 : fixed !== raw ? 0.85 : 1, minConf: 30 });
    // potwierdzenie: środkowa część = „Pozycja planu”
    const plan = valueAt(page, ["Pozycja planu"]);
    if (f.docNumber.value && plan && m[2] && plan.words.map(w => w.text).join("").includes(m[2]) && f.docNumber.confidence != null && !doubtful) {
      f.docNumber.confidence = Math.min(1, f.docNumber.confidence + 0.1);
    }
    break;
  }
  f.docDate = labeledDate(page, [["Data wystawienia"], ["Wydano dnia"], ["Data wywozu", "Data"]]);
  if (!f.docDate.value) f.docDate = anyDate(page, 0.8);
  // nadleśnictwo — „Nadleśnictwo : PGL LP NADLEŚNICTWO ZAWADZKIE”
  f.forestDistrict = EMPTY();
  for (const line of page.lines) {
    if (/^\s*\W*adres/i.test(norm(line.text))) continue;
    // ostatnie wystąpienie „NADLEŚNICTWO <nazwa>” w linii (pierwsze bywa etykietą pola)
    const all = [...line.text.matchAll(/(?:\bPGL\s+LP\s+)?NADLE[SŚ]NICTWO\s+([^|:;]+)/gi)];
    const m = all.length ? all[all.length - 1] : null;
    if (m && LABEL_WORDS.test(norm(m[1]))) continue; // wiersz nagłówków pól, np. „NADLEŚNICTWO NABYWCA”
    if (m && !/^\s*\W*nadle[sś]nictwo\s*$/i.test(line.text) && norm(m[1]).length >= 3 && !/adres/i.test(m[0])) {
      const value = strip(m[0]).replace(/\s{2,}/g, " ");
      const ws = wordsCovering(line, value);
      f.forestDistrict = fieldFromWords(ws.length ? ws : line.words, page, { value, factor: 0.95 });
      if (f.forestDistrict.value) break;
    }
  }
  if (!f.forestDistrict.value) f.forestDistrict = labeled(page, ["Nadleśnictwo"], 0.9);
  f.forestRange = labeled(page, ["Nazwa leśnictwa", "Leśnictwo"]);
  // transport: nr rej. pojazdu
  const reg = valueAt(page, ["Nr rej. pojazdu", "Nr rej pojazdu", "Nr rejestracyjny", "Nr rej."]);
  f.vehicleReg = EMPTY();
  if (reg) {
    const p = findPlate(reg.words.map(w => w.text).join(" "));
    if (p) { const ws = wordsCovering({ text: "", conf: 0, bbox: reg.words[0].bbox, words: reg.words }, p); f.vehicleReg = fieldFromWords(ws.length ? ws : reg.words.slice(0, 2), page, { value: p, factor: reg.quality }); }
  }
  // transport: ilość m3 — „SO/M2 / 17,50 / 1” (masy i ilości łączne) albo kolumna „Masa[m3]” / „Razem”
  f.quantity = EMPTY();
  const hdr = page.lines.findIndex(l => /masy\s*\[?\s*m\s*3/i.test(norm(l.text).replace(/ /g, " ")) || /masy.*m3/.test(norm(l.text)));
  const candidates = hdr >= 0 ? page.lines.slice(hdr, hdr + 3) : [];
  for (const line of [...candidates, ...page.lines.filter(l => /razem|miazszosc|masa/i.test(norm(l.text)))]) {
    const m = line.text.match(/\/\s*(\d+[.,]\d{1,3})\s*(?:\/|$)/) || line.text.match(/(\d+[.,]\d{2})\s*(?:m3|m³)?\s*$/) || line.text.match(/(\d+[.,]\d{1,3})\s*(?:m3|m³)/i);
    if (!m) continue;
    const ws = wordsCovering(line, m[1]);
    f.quantity = fieldFromWords(ws.length ? ws : line.words, page, { value: `${m[1].replace(".", ",")} m3`, factor: 0.95 });
    if (f.quantity.value) break;
  }
  if (!f.quantity.value) {
    // dowolna liczba dziesiętna z jednostką m3 w dokumencie
    for (const line of page.lines) {
      const m = line.text.match(/(\d+[.,]\d{1,3})\s*(?:m3|m³|m\^3)\b/i);
      if (!m) continue;
      const ws = wordsCovering(line, m[0]);
      f.quantity = fieldFromWords(ws.length ? ws : line.words, page, { value: `${m[1].replace(".", ",")} m3`, factor: 0.85 });
      if (f.quantity.value) break;
    }
  }
  return f;
}

/** Pierwsza poprawna data w dokumencie (gdy brak etykiety). */
function anyDate(page, factor) {
  for (const line of page.lines) {
    const d = findDate(line.text);
    if (!d) continue;
    const f = fieldFromWords(line.words.filter(w => /\d/.test(w.text)).slice(0, 3), page, { value: d, factor });
    if (f.value) return f;
  }
  return EMPTY();
}

/** @param {OcrPage} page @param {string} type */
function extractWzPz(page, type) {
  /** @type {Record<string, RawField>} */
  const f = {};
  f.docDate = labeledDate(page, [["Data wystawienia"], ["Data wysyłki"], ["Data"]]);
  if (!f.docDate.value) f.docDate = anyDate(page, 0.8);
  f.supplier = labeled(page, ["Dostawca", "Sprzedawca"], 0.9);
  f.recipient = labeled(page, ["Nazwa i adres odbiorcy", "Odbiorca", "Nabywca"], 0.9);
  // pole etykiety bez wartości (np. sam nagłówek kolumny) — odrzuć wartości będące innymi etykietami formularza
  for (const k of ["supplier", "recipient"]) if (f[k].value && /^(przeznaczenie|nr|data|regon|wz|pz|symbol|cena|ilo)/i.test(norm(f[k].value))) f[k] = EMPTY();
  // nr rej. — przy „Środek transportu” (ta sama lub kolejna linia) albo pierwszy wzorzec tablicy w dokumencie
  f.vehicleReg = EMPTY();
  const idx = page.lines.findIndex(l => /srodek\s*transp|samochod|nr\s*rej/.test(norm(l.text)));
  const scan = idx >= 0 ? page.lines.slice(idx, idx + 3) : [];
  for (const line of scan) {
    const p = findPlate(line.text);
    if (p) { const ws = wordsCovering(line, p); f.vehicleReg = fieldFromWords(ws.length ? ws : line.words, page, { value: p, factor: 0.9 }); if (f.vehicleReg.value) break; }
  }
  // ilość: liczba z jednostką MP / m3 / t
  f.quantity = EMPTY(); f.netWeight = EMPTY();
  const found = [];
  for (const line of page.lines) {
    for (const m of line.text.matchAll(/(\d+(?:[.,]\d{1,3})?)\s*(mp|m\.p\.|m3|m³|ton|t)\b\.?/gi)) {
      const unit = /^m\.?p/i.test(m[2]) ? "MP" : /^m/i.test(m[2]) ? "m3" : "t";
      const ws = wordsCovering(line, m[0]);
      const fld = fieldFromWords(ws.length ? ws : line.words, page, { value: `${m[1]} ${unit === "MP" ? "MP" : unit}`, factor: 0.9 });
      if (fld.value) found.push({ unit, fld });
    }
  }
  const mp = found.find(x => x.unit === "MP"), m3 = found.find(x => x.unit === "m3"), t = found.find(x => x.unit === "t");
  f.quantity = (mp || m3 || t || { fld: EMPTY() }).fld;
  if (type === "PZ" && mp && t) f.netWeight = t.fld;
  return f;
}

/** @param {OcrPage} page */
function extractKwitWagowy(page) {
  /** @type {Record<string, RawField>} */
  const f = {};
  f.docDate = labeledDate(page, [["Data"], ["Data ważenia"]]);
  if (!f.docDate.value) f.docDate = anyDate(page, 0.85);
  const tm = valueAt(page, ["Godz.", "Godzina"]);
  f.time = EMPTY();
  if (tm) { const m = tm.words.map(w => w.text).join(" ").match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/); if (m) f.time = fieldFromWords(tm.words.slice(0, 1), page, { value: m[0], factor: tm.quality }); }
  if (!f.time.value) {
    for (const line of page.lines) { const m = line.text.match(/godz\.?\s*:?\s*(\d{1,2}[:.]\d{2})/i); if (m) { const ws = wordsCovering(line, m[1]); f.time = fieldFromWords(ws.length ? ws : line.words, page, { value: m[1], factor: 0.9 }); break; } }
  }
  f.supplier = labeled(page, ["Dostawca"], 0.95);
  f.recipient = labeled(page, ["Odbiorca"], 0.95);
  f.product = labeled(page, ["Towar", "Asortyment"], 0.95);
  const weight = labels => {
    const v = valueAt(page, labels);
    if (!v) return EMPTY();
    const m = v.words.map(w => w.text).join(" ").match(/(\d[\d\s.,]*\d|\d)\s*(kg|t)\b/i);
    if (!m) return EMPTY();
    return fieldFromWords(v.words.filter(w => /\d|kg|^t$/i.test(w.text)), page, { value: `${m[1].trim()} ${m[2].toLowerCase()}`, factor: v.quality });
  };
  f.grossWeight = weight(["BRUTTO"]);
  f.tareWeight = weight(["TARA"]);
  f.netWeight = weight(["NETTO"]);
  const plate = labels => { const v = valueAt(page, labels); const p = v && findPlate(v.words.map(w => w.text).join(" ")); return p && v ? fieldFromWords(wordsCovering({ text: "", conf: 0, bbox: v.words[0].bbox, words: v.words }, p), page, { value: p, factor: v.quality }) : EMPTY(); };
  f.vehicleReg = plate(["Pojazd", "Nr rej.", "Nr rej", "Samochód"]);
  f.trailerReg = plate(["Naczepa", "Przyczepa"]);
  f.driver = labeled(page, ["Kierowca"], 0.9);
  return f;
}

/**
 * Strona OCR → RawExtraction (format providera).
 * @param {OcrPage} page
 * @param {{ hintType?: string|null }} [opts]
 */
export function extractFromOcr(page, opts = {}) {
  const detected = detectType(page);
  const type = opts.hintType && opts.hintType !== "AUTO" ? opts.hintType : detected.value;
  /** @type {Record<string, RawField>} */
  let f = {};
  if (type === "KWIT_WYWOZOWY") f = extractKwitWywozowy(page);
  else if (type === "WZ" || type === "PZ") f = extractWzPz(page, type);
  else if (type === "KWIT_WAGOWY") f = extractKwitWagowy(page);
  else f = Object.assign({}, extractWzPz(page, "WZ"), { docNumber: EMPTY(), forestDistrict: EMPTY(), forestRange: EMPTY() });
  const fields = Object.fromEntries(FIELD_KEYS.map(k => [k, f[k] || EMPTY()]));
  // WZ / PZ to formularze wypełniane zwykle ręcznie: pewność znaków OCR nie gwarantuje poprawnego
  // odczytu pisma (np. „PY” → „DY”) — odczyt zawsze do sprawdzenia (najwyżej FORM_CAP)
  if (isForm(type)) {
    for (const [k, fl] of Object.entries(fields)) {
      if (fl.confidence == null) continue;
      // szum z pisma ręcznego: za mało pewne słowa → pole puste (do wpisania), a nie „zgadnięta” wartość
      if (fl.confidence < MIN_FORM_CONF / 100 * 0.9) { fields[k] = EMPTY(); continue; }
      fl.confidence = Math.min(fl.confidence, FORM_CAP);
    }
  }
  capIds(fields);
  const text = page.lines.map(l => l.text).join("\n");
  const meanConf = page.lines.length ? Math.round(page.lines.reduce((a, l) => a + (l.conf || 0), 0) / page.lines.length) : 0;
  return {
    docType: opts.hintType && opts.hintType !== "AUTO" && opts.hintType !== detected.value
      ? { value: type, confidence: 1, evidence: `Typ wybrany przez użytkownika (OCR: ${detected.value}).` }
      : detected,
    fields,
    rawText: text || null,
    notes: `OCR Tesseract (lokalnie, bez internetu): średnia pewność rozpoznania tekstu ${meanConf}%. Pismo odręczne jest zwykle nieczytelne dla OCR — uzupełnij puste pola ręcznie.`
  };
}

/**
 * Pewność słowa z pewności znaków. Pewność całego słowa w Tesseract bywa 0 dla ciągów spoza słownika
 * (numery, tablice rejestracyjne), choć każdy znak jest pewny — znaki są lepszą miarą.
 * Wynik: 0,6 × średnia + 0,4 × minimum (jeden niepewny znak obniża pewność).
 */
export function wordConfidence(w) {
  const sy = (w.symbols || []).map(s => Number(s.confidence)).filter(Number.isFinite);
  if (!sy.length) return Number(w.confidence) || 0;
  const mean = sy.reduce((a, b) => a + b, 0) / sy.length;
  return Math.round(0.6 * mean + 0.4 * Math.min(...sy));
}

/**
 * Wynik Tesseract.js (data z blocks) → OcrPage.
 * @param {any} data @param {number} width @param {number} height
 * @returns {OcrPage}
 */
export function pageFromTesseract(data, width, height) {
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    lines.push({
      text: String(l.text || "").replace(/\s+$/, ""), conf: l.confidence, bbox: l.bbox,
      words: (l.words || []).map(w => ({ text: w.text, conf: wordConfidence(w), bbox: w.bbox }))
    });
  }
  return { width, height, lines };
}

/* ------------------------------------------------------------------ */
/* Dwa przebiegi OCR → jeden wynik                                     */
/* ------------------------------------------------------------------ */

const cmpKey = v => norm(fixDigits(String(v))).replace(/ /g, "");

/**
 * Łączy wyniki dwóch przebiegów OCR tego samego zdjęcia (np. oryginał i powiększenie).
 * Zgodne odczyty → wyższa pewność; odczyt tylko w jednym przebiegu → pewność × 0,85;
 * rozbieżne → wartość pewniejsza, pewność najwyżej 0,5 i ostrzeżenie z obiema wersjami.
 * @param {any} a RawExtraction (przebieg 1) @param {any} b RawExtraction (przebieg 2)
 */
export function mergeExtractions(a, b) {
  /** @type {Record<string, any>} */
  const fields = {};
  const form = isForm(a.docType.value === b.docType.value ? a.docType.value : (a.docType.confidence >= b.docType.confidence ? a.docType.value : b.docType.value));
  for (const k of FIELD_KEYS) {
    const x = a.fields[k] || EMPTY(), y = b.fields[k] || EMPTY();
    if (x.value == null && y.value == null) { fields[k] = EMPTY(); continue; }
    if (x.value == null || y.value == null) {
      // formularze WZ / PZ (pismo ręczne): wartość tylko z jednego przebiegu to zwykle szum — pole puste
      if (form) { fields[k] = EMPTY(); continue; }
      const one = x.value != null ? x : y;
      fields[k] = { ...one, confidence: one.confidence == null ? null : Math.round(one.confidence * 0.85 * 1000) / 1000 };
      continue;
    }
    const best = (x.confidence ?? 0) >= (y.confidence ?? 0) ? x : y, other = best === x ? y : x;
    const same = cmpKey(x.value) === cmpKey(y.value);
    const kx = cmpKey(x.value), ky = cmpKey(y.value);
    // tekst (bez cyfr): drobna różnica albo jeden odczyt zawiera drugi (np. z dopiskiem etykiety)
    const contained = !/\d/.test(String(best.value)) && Math.min(kx.length, ky.length) >= 6 && (kx.endsWith(ky) || ky.endsWith(kx));
    const close = !same && (contained || (lev(kx, ky) <= Math.max(1, Math.floor(cmpKey(best.value).length * 0.15)) && !/\d/.test(String(best.value))));
    if (same) fields[k] = { ...best, confidence: Math.min(1, Math.round(((best.confidence ?? 0) + 0.05) * 1000) / 1000) };
    else if (close) {
      const pick = contained ? (kx.length <= ky.length ? x : y) : best; // krótszy = bez dopisanej etykiety
      fields[k] = { ...pick, confidence: Math.round(Math.max(x.confidence ?? 0, y.confidence ?? 0) * 0.9 * 1000) / 1000 };
    }
    else fields[k] = { ...best, confidence: Math.min(0.5, best.confidence ?? 0.5), warnings: [`Dwa odczyty OCR różnią się: „${best.value}” / „${other.value}” — sprawdź na zdjęciu.`] };
  }
  const docType = a.docType.value === b.docType.value
    ? { ...a.docType, confidence: Math.max(a.docType.confidence, b.docType.confidence) }
    : (a.docType.confidence >= b.docType.confidence ? a.docType : b.docType);
  const longer = (a.rawText || "").length >= (b.rawText || "").length ? a : b;
  capIds(fields);
  if (isForm(docType.value)) for (const f of Object.values(fields)) if (f.confidence != null) f.confidence = Math.min(f.confidence, FORM_CAP);
  return { docType, fields, rawText: longer.rawText, notes: (a.notes || "") + " Odczyt podwójny (oryginał + powiększenie) — rozbieżności obniżają pewność." };
}

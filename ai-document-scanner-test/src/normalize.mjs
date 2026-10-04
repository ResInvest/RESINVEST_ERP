// @ts-check
/* =========================================================================
   AI Document Scanner Test — normalizacja i walidacja odczytu

   Wejście: surowy wynik providera (RawExtraction). Wyjście: wynik do pokazania
   (ScanResult.fields), w którym każde pole ma:
     value       — tekst do pokazania (po ujednoliceniu zapisu) albo null,
     normalized  — wartość typowana (data ISO, liczba + jednostka, nr rej.) albo null,
     confidence  — pewność 0..1 (pewność providera obniżona, gdy format jest niepoprawny),
     bbox        — [x0,y0,x1,y1] 0..1 albo null,
     warnings    — lista ostrzeżeń walidacji.

   Zasady:
   * brak wartości = null; nic nie jest dopisywane ani wyliczane „za” dokument,
   * wyliczenia kontrolne (np. netto = brutto \u2212 tara) są tylko OSTRZEŻENIEM / podpowiedzią,
   * normalizacja nie zmienia sensu odczytu (np. nie poprawia cyfr).
   ========================================================================= */
import { FIELDS, FIELD_BY_KEY, DOC_TYPE_KEYS, fieldsFor, QUANTITY_UNITS } from "./schema.mjs";

/**
 * @typedef {{ value: string|null, confidence: number|null, bbox: number[]|null }} RawField
 * @typedef {{ docType: { value: string, confidence: number, evidence?: string|null }, fields: Record<string, RawField>, rawText?: string|null, notes?: string|null }} RawExtraction
 * @typedef {{ value: string|null, normalized: any, confidence: number|null, bbox: number[]|null, warnings: string[], source: "ai"|"manual" }} FieldResult
 */

/** Wartości oznaczające „brak” — zamieniane na null. */
const EMPTY_MARKERS = new Set(["", "-", "—", "–", "--", "brak", "n/a", "na", "null", "none", "nieczytelne", "?", "x"]);

/** Limit pewności, gdy wartość nie przechodzi walidacji formatu. */
export const CAP_INVALID = 0.5;
/** Limit pewności, gdy format jest nietypowy (np. zagraniczny numer rejestracyjny). */
export const CAP_UNUSUAL = 0.7;

export function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
}

export function isEmptyValue(v) {
  if (v == null) return true;
  const s = String(v).replace(/\s+/g, " ").trim().toLowerCase();
  return EMPTY_MARKERS.has(s);
}

/* ------------------------------------------------------------------ */
/* Liczby w zapisie polskim                                            */
/* ------------------------------------------------------------------ */

/** „1.250” — kropka i dokładnie 3 cyfry: w PL zwykle separator tysięcy, ale może być ułamkiem. */
const AMBIGUOUS_DOT = /^[1-9]\d{0,2}\.\d{3}$/;

/** Czy zapis liczby jest niejednoznaczny (np. „1.250” = 1250 czy 1,25)? */
export function isAmbiguousNumber(text) {
  const m = String(text || "").replace(/\u00A0/g, " ").trim().match(/[+-]?[\d\s.,']*\d/);
  return !!m && AMBIGUOUS_DOT.test(m[0].replace(/[\s']/g, "").replace(/^[+-]/, ""));
}

/**
 * Tekst liczby → number. Obsługuje: 68,40 · 1 234,5 · 1.234,5 · 12.50 · NBSP.
 * Zwraca null, gdy tekst nie jest jednoznaczną liczbą.
 * @param {string} input
 * @returns {number|null}
 */
export function parsePlNumber(input) {
  let s = String(input == null ? "" : input).replace(/[\s\u00A0\u2007\u2009\u202F']/g, "").replace(/\u2212/g, "-");
  if (!s) return null;
  if (!/^[+-]?(\d[\d.,]*\d|\d)$/.test(s) && !/^[+-]?[.,]\d+$/.test(s)) return null;
  let sign = 1;
  if (s[0] === "-" || s[0] === "+") { if (s[0] === "-") sign = -1; s = s.slice(1); }
  const nC = s.split(",").length - 1, nD = s.split(".").length - 1;
  let dec = null, thou = null;
  if (nC && nD) { dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : "."; thou = dec === "," ? "." : ","; }
  else if (nC) { if (nC === 1) dec = ","; else thou = ","; }
  else if (nD) {
    // „1.234” bez innych separatorów jest niejednoznaczne (tysiące czy ułamek) — w PL to zwykle tysiące przy 3 cyfrach po kropce.
    if (nD === 1) dec = AMBIGUOUS_DOT.test(s) ? null : ".";
    if (nD > 1 || dec === null) thou = ".";
  }
  let intPart = s, frac = "";
  if (dec) {
    const i = s.lastIndexOf(dec);
    intPart = s.slice(0, i); frac = s.slice(i + 1);
    if (/[.,]/.test(frac)) return null;
  }
  if (thou && intPart.includes(thou)) {
    const g = intPart.split(thou);
    if (!(g[0].length >= 1 && g[0].length <= 3 && g.slice(1).every(x => x.length === 3))) return null;
    intPart = g.join("");
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const v = sign * Number((intPart || "0") + (frac ? "." + frac : ""));
  return Number.isFinite(v) ? v : null;
}

/** Liczba → zapis polski (przecinek dziesiętny, spacja tysięcy), bez zbędnych zer powyżej `minDec`. */
export function formatPl(n, minDec = 0, maxDec = 3) {
  const f = Math.pow(10, maxDec);
  const r = Math.round(Math.abs(n) * f) / f;
  let [i, d = ""] = r.toFixed(maxDec).split(".");
  d = d.replace(/0+$/, "");
  while (d.length < minDec) d += "0";
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return (n < 0 && r !== 0 ? "-" : "") + i + (d ? "," + d : "");
}

/* ------------------------------------------------------------------ */
/* Jednostki                                                           */
/* ------------------------------------------------------------------ */

const UNIT_ALIASES = [
  { unit: "MP", re: /^(mp|m\.p\.?|mpu|mp\.|metr(y|ów)?\s*przestrzenn\w*|mtp)$/i },
  { unit: "m3", re: /^(m3|m³|m\^3|m3\.|msz|m\s*sześc\w*|metr(y|ów)?\s*sześc\w*)$/i },
  { unit: "t", re: /^(t|t\.|ton(a|y)?|tony|tn|mg)$/i },
  { unit: "kg", re: /^(kg|kg\.|kilogram\w*)$/i },
  { unit: "szt", re: /^(szt|szt\.|sztuk\w*)$/i }
];

/** @returns {string|null} kanoniczna jednostka (MP, m3, t, kg, szt) albo null */
export function canonicalUnit(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  for (const a of UNIT_ALIASES) if (a.re.test(s)) return a.unit;
  return null;
}

/**
 * „68,40 MP” → { amount: 68.4, unit: "MP" }. Jednostka może być przed lub po liczbie.
 * @returns {{ amount: number|null, unit: string|null, unitRaw: string|null }}
 */
export function parseQuantity(text) {
  const s = String(text || "").replace(/\u00A0/g, " ").trim();
  const m = s.match(/^([+-]?[\d\s.,']*\d)\s*([^\d\s].*)?$/) || s.match(/^([^\d+-][^\d]*?)\s*([+-]?[\d\s.,']*\d)$/);
  if (!m) return { amount: null, unit: null, unitRaw: null };
  let numPart = m[1], unitPart = m[2] || "";
  if (!/\d/.test(numPart)) { const t = numPart; numPart = unitPart; unitPart = t; }
  const amount = parsePlNumber(numPart);
  const unitRaw = unitPart.trim() || null;
  return { amount, unit: unitRaw ? canonicalUnit(unitRaw) : null, unitRaw };
}

/* ------------------------------------------------------------------ */
/* Daty i godziny                                                      */
/* ------------------------------------------------------------------ */

function validYMD(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Data w typowych zapisach → ISO (RRRR-MM-DD). Obsługuje DD.MM.RRRR, D.M.RR, DD-MM-RRRR, DD/MM/RRRR, RRRR-MM-DD.
 * Zapis RR jest rozwijany do 20RR. Zwraca null, gdy data jest niepoprawna lub niejednoznaczna.
 * @returns {string|null}
 */
export function parseDate(text) {
  // „27/03/2026 15:12:05” — godzina po dacie jest pomijana (osobne pole „Godzina”)
  const s = String(text || "").trim().replace(/[\sT]+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?$/, "").replace(/\s*r\.?$/i, "").replace(/\s+/g, "");
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  }
  if (!validYMD(y, mo, d)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isoToPl(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

/** „7:05”, „07.05”, „07:05:31” → „07:05” / „07:05:31”; null gdy niepoprawna. */
export function parseTime(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2], se = m[3] == null ? null : +m[3];
  if (h > 23 || mi > 59 || (se != null && se > 59)) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}` + (se != null ? `:${m[3]}` : "");
}

/* ------------------------------------------------------------------ */
/* Numery rejestracyjne                                                */
/* ------------------------------------------------------------------ */

/** Polski numer rejestracyjny: wyróżnik 1–3 litery + 3–5 znaków (litery/cyfry). */
const PL_PLATE = /^[A-Z]{1,3}\s?[A-Z0-9]{3,5}$/;

/** Ujednolicenie zapisu: wielkie litery, pojedyncze spacje, bez myślników/kropek. */
export function normalizePlate(text) {
  return String(text || "").toUpperCase().replace(/[-.·_]/g, " ").replace(/\s+/g, " ").trim();
}

export function isPolishPlate(plate) {
  return PL_PLATE.test(normalizePlate(plate));
}

/** Klucz porównania tablic (bez spacji) — do dopasowania z kartoteką floty. */
export function plateKey(plate) {
  return normalizePlate(plate).replace(/\s/g, "");
}

/* ------------------------------------------------------------------ */
/* Ramki (bbox)                                                        */
/* ------------------------------------------------------------------ */

/**
 * Walidacja ramki [x0,y0,x1,y1] w układzie 0..1. Toleruje odwróconą kolejność rogów i niewielkie
 * wyjście poza zakres (przycięcie). Zwraca null dla ramki nieprawidłowej.
 * @returns {number[]|null}
 */
export function normalizeBbox(b) {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const n = b.map(Number);
  if (n.some(x => !Number.isFinite(x))) return null;
  // ramka w pikselach / procentach — nie zgadujemy skali, odrzucamy
  if (n.some(x => x < -0.05 || x > 1.05)) return null;
  const c = n.map(x => Math.min(1, Math.max(0, x)));
  const x0 = Math.min(c[0], c[2]), x1 = Math.max(c[0], c[2]);
  const y0 = Math.min(c[1], c[3]), y1 = Math.max(c[1], c[3]);
  if (x1 - x0 < 0.002 || y1 - y0 < 0.002) return null;
  return [x0, y0, x1, y1].map(x => Math.round(x * 10000) / 10000);
}

/* ------------------------------------------------------------------ */
/* Normalizacja pojedynczego pola                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {string} key
 * @param {RawField|null|undefined} raw
 * @param {"ai"|"manual"} [source]
 * @returns {FieldResult}
 */
export function normalizeField(key, raw, source = "ai") {
  const def = FIELD_BY_KEY[key];
  if (!def) throw new Error("Nieznane pole: " + key);
  const warnings = [];
  const rawValue = raw && raw.value != null ? String(raw.value).replace(/\s+/g, " ").trim() : null;
  if (rawValue == null || isEmptyValue(rawValue)) {
    // pewność „braku” nie ma sensu — null oznacza: nie ma na dokumencie / nieczytelne
    return { value: null, normalized: null, confidence: null, bbox: null, warnings, source };
  }
  let confidence = source === "manual" ? 1 : clamp01(raw && raw.confidence);
  if (confidence == null && source === "ai") warnings.push("Provider nie podał pewności odczytu.");
  const cap = c => { if (confidence != null && source === "ai") confidence = Math.min(confidence, c); };
  let value = rawValue;
  let normalized = null;

  switch (def.kind) {
    case "date": {
      const iso = parseDate(rawValue);
      if (iso) { normalized = iso; value = isoToPl(iso); }
      else { warnings.push("Niepoprawny lub niejednoznaczny format daty."); cap(CAP_INVALID); }
      break;
    }
    case "time": {
      const tm = parseTime(rawValue);
      if (tm) { normalized = tm; value = tm; }
      else { warnings.push("Niepoprawny format godziny."); cap(CAP_INVALID); }
      break;
    }
    case "quantity": {
      const q = parseQuantity(rawValue);
      if (q.amount == null) { warnings.push("Nie udało się odczytać liczby."); cap(CAP_INVALID); }
      else if (q.amount <= 0) { warnings.push("Ilość musi być większa od zera."); cap(CAP_INVALID); }
      if (q.amount != null && isAmbiguousNumber(rawValue)) { warnings.push(`Niejednoznaczny zapis liczby — odczytano jako ${formatPl(q.amount)}; sprawdź separator.`); cap(CAP_UNUSUAL); }
      if (q.amount != null && !q.unitRaw) { warnings.push("Brak jednostki na dokumencie — nie przyjęto jednostki domyślnej."); cap(CAP_UNUSUAL); }
      else if (q.unitRaw && !q.unit) { warnings.push(`Nieznana jednostka „${q.unitRaw}”.`); cap(CAP_UNUSUAL); }
      if (q.amount != null) {
        normalized = { amount: q.amount, unit: q.unit };
        value = formatPl(q.amount, q.unit === "MP" || q.unit === "m3" || q.unit === "t" ? 2 : 0) + (q.unit ? " " + q.unit : q.unitRaw ? " " + q.unitRaw : "");
      }
      break;
    }
    case "weight": {
      const q = parseQuantity(rawValue);
      if (q.amount == null) { warnings.push("Nie udało się odczytać masy."); cap(CAP_INVALID); break; }
      if (q.amount < 0) { warnings.push("Masa nie może być ujemna."); cap(CAP_INVALID); }
      if (isAmbiguousNumber(rawValue)) { warnings.push(`Niejednoznaczny zapis liczby — odczytano jako ${formatPl(q.amount)}; sprawdź separator.`); cap(CAP_UNUSUAL); }
      const unit = q.unit === "kg" || q.unit === "t" ? q.unit : null;
      if (!q.unitRaw) { warnings.push("Brak jednostki masy (kg / t) — nie przyjęto domyślnej."); cap(CAP_UNUSUAL); }
      else if (!unit) { warnings.push(`Jednostka „${q.unitRaw}” nie jest jednostką masy.`); cap(CAP_INVALID); }
      normalized = { amount: q.amount, unit, kg: unit === "kg" ? q.amount : unit === "t" ? q.amount * 1000 : null };
      value = formatPl(q.amount, unit === "t" ? 2 : 0) + (unit ? " " + unit : q.unitRaw ? " " + q.unitRaw : "");
      break;
    }
    case "plate": {
      const p = normalizePlate(rawValue);
      value = p; normalized = p;
      if (!/[0-9]/.test(p) || p.replace(/\s/g, "").length < 4 || p.replace(/\s/g, "").length > 9) { warnings.push("To nie wygląda na numer rejestracyjny."); cap(CAP_INVALID); }
      else if (!isPolishPlate(p)) { warnings.push("Nietypowy format numeru (możliwy numer zagraniczny) — sprawdź."); cap(CAP_UNUSUAL); }
      break;
    }
    default:
      normalized = rawValue;
  }
  return { value, normalized, confidence: confidence == null ? null : Math.round(confidence * 1000) / 1000, bbox: normalizeBbox(raw && raw.bbox), warnings, source };
}

/* ------------------------------------------------------------------ */
/* Kontrole krzyżowe (tylko ostrzeżenia — nic nie jest uzupełniane)    */
/* ------------------------------------------------------------------ */

/**
 * @param {string} docType
 * @param {Record<string, FieldResult>} fields
 * @returns {{ warnings: string[], hints: string[] }}
 */
export function crossCheck(docType, fields) {
  const warnings = [], hints = [];
  const kg = k => fields[k] && fields[k].normalized && fields[k].normalized.kg != null ? fields[k].normalized.kg : null;
  const g = kg("grossWeight"), t = kg("tareWeight"), n = kg("netWeight");
  if (g != null && t != null && n != null) {
    const diff = Math.abs(g - t - n);
    if (diff > Math.max(1, Math.abs(n) * 0.005)) warnings.push(`Masa netto (${formatPl(n)} kg) różni się od brutto \u2212 tara (${formatPl(g - t)} kg) o ${formatPl(diff)} kg — sprawdź odczyt.`);
  } else if (g != null && t != null && n == null) {
    hints.push(`Masy netto nie odczytano. Z brutto \u2212 tara wynikałoby ${formatPl(g - t)} kg — wartość NIE została wpisana (tylko podpowiedź).`);
  }
  if (g != null && t != null && t > g) warnings.push("Tara jest większa niż masa brutto.");
  const v = fields.vehicleReg && fields.vehicleReg.normalized, tr = fields.trailerReg && fields.trailerReg.normalized;
  if (v && tr && plateKey(v) === plateKey(tr)) warnings.push("Numer naczepy jest taki sam jak numer samochodu.");
  if (docType === "WZ" && !(fields.recipient && fields.recipient.value)) warnings.push("Na WZ nie odczytano odbiorcy.");
  if (docType === "PZ" && !(fields.supplier && fields.supplier.value)) warnings.push("Na PZ nie odczytano dostawcy.");
  const d = fields.docDate && fields.docDate.normalized;
  if (d) {
    const today = new Date().toISOString().slice(0, 10);
    if (d > today) warnings.push("Data dokumentu jest z przyszłości — sprawdź odczyt.");
  }
  return { warnings, hints };
}

/* ------------------------------------------------------------------ */
/* Pola właściwe dla typu dokumentu                                    */
/* ------------------------------------------------------------------ */

/** @returns {FieldResult} */
const emptyField = (source = /** @type {"ai"|"manual"} */ ("ai")) => ({ value: null, normalized: null, confidence: null, bbox: null, warnings: [], source });

/**
 * Zostawia tylko pola odczytywane dla typu (pozostałe = null) i sprawdza jednostkę ilości
 * (kwit wywozowy: m3; WZ / PZ: MP, m3 albo t).
 * @param {string} docType
 * @param {Record<string, FieldResult>} all  pola po normalizacji (wszystkie)
 * @returns {Record<string, FieldResult>}
 */
export function applyTypeRules(docType, all) {
  const keep = fieldsFor(docType);
  /** @type {Record<string, FieldResult>} */
  const out = {};
  for (const f of FIELDS) out[f.key] = keep.includes(f.key) && all[f.key] ? structuredClone(all[f.key]) : emptyField();
  const q = out.quantity, allowed = QUANTITY_UNITS[/** @type {keyof typeof QUANTITY_UNITS} */ (docType)];
  if (allowed && q.value != null && q.normalized && q.normalized.unit && !allowed.includes(q.normalized.unit)) {
    q.warnings.push(`Jednostka ${q.normalized.unit} nietypowa dla tego dokumentu (oczekiwano: ${allowed.join(", ")}).`);
    if (q.source === "ai" && q.confidence != null) q.confidence = Math.min(q.confidence, CAP_UNUSUAL);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Normalizacja całego wyniku                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {RawExtraction} raw
 * @param {{ hintType?: string|null }} [opts]
 */
export function normalizeExtraction(raw, opts = {}) {
  if (!raw || typeof raw !== "object" || !raw.docType || !raw.fields || typeof raw.fields !== "object") {
    throw new Error("Provider zwrócił wynik w nieoczekiwanym formacie.");
  }
  const warnings = [];
  let typeValue = String(raw.docType.value || "").toUpperCase();
  let typeConf = clamp01(raw.docType.confidence);
  if (!DOC_TYPE_KEYS.includes(/** @type {any} */ (typeValue))) {
    warnings.push(`Provider zwrócił nieznany typ dokumentu „${raw.docType.value}”.`);
    typeValue = "NIEZNANY"; typeConf = 0;
  }
  if (opts.hintType && opts.hintType !== typeValue && typeValue !== "NIEZNANY") {
    warnings.push(`Wybrano typ ${opts.hintType}, a dokument wygląda na ${typeValue}. Pozostawiono typ rozpoznany — zmień ręcznie, jeśli trzeba.`);
  }
  /** Wszystkie odczytane pola (po normalizacji) — potrzebne, gdy użytkownik zmieni typ dokumentu. */
  /** @type {Record<string, FieldResult>} */
  const extracted = {};
  for (const f of FIELDS) extracted[f.key] = normalizeField(f.key, raw.fields[f.key], "ai");
  const unknown = Object.keys(raw.fields).filter(k => !FIELD_BY_KEY[k]);
  if (unknown.length) warnings.push("Pominięto nieznane pola: " + unknown.join(", "));
  const fields = applyTypeRules(typeValue, extracted);
  const cc = crossCheck(typeValue, fields);
  return {
    docType: { value: typeValue, confidence: typeConf == null ? null : Math.round(typeConf * 1000) / 1000, evidence: raw.docType.evidence || null, source: /** @type {"ai"|"manual"} */ ("ai") },
    fields,
    extracted,
    rawText: raw.rawText ? String(raw.rawText) : null,
    notes: raw.notes ? String(raw.notes) : null,
    warnings,
    checks: cc.warnings,
    hints: cc.hints
  };
}

/** Średnia pewność pól z wartością (do podsumowania). */
export function averageConfidence(fields) {
  const xs = Object.values(fields).map(f => f.confidence).filter(c => c != null);
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 1000) / 1000;
}

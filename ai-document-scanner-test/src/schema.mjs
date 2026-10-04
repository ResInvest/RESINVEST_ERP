// @ts-check
/* =========================================================================
   AI Document Scanner Test — schemat dokumentów i pól

   Jedno źródło prawdy dla: providerów AI (schemat JSON odpowiedzi), normalizacji,
   interfejsu i testów. Nazwy pól są neutralne (angielskie klucze), etykiety — PL.

   Zasada: pole, którego NIE MA na dokumencie, ma wartość null. Moduł nigdy nie
   uzupełnia brakujących danych założeniami.
   ========================================================================= */

export const SCHEMA_VERSION = 1;

/** @typedef {"PZ"|"WZ"|"KWIT_WYWOZOWY"|"KWIT_WAGOWY"|"NIEZNANY"} DocType */
/** @typedef {"text"|"date"|"time"|"quantity"|"weight"|"plate"} FieldKind */

/**
 * @typedef {object} FieldDef
 * @property {string} key
 * @property {string} label
 * @property {FieldKind} kind
 * @property {string} hint   opis dla modelu AI (co dokładnie odczytać)
 * @property {string} [erp]  odpowiednik w danych ResInvest ERP (tylko dokumentacja integracji)
 */

/** @type {Record<DocType, { label: string, description: string }>} */
export const DOC_TYPES = {
  PZ: { label: "PZ — przyjęcie zewnętrzne", description: "Dokument magazynowy przyjęcia towaru (Przyjęcie Zewnętrzne)." },
  WZ: { label: "WZ — wydanie zewnętrzne", description: "Dokument magazynowy wydania towaru (Wydanie Zewnętrzne)." },
  KWIT_WYWOZOWY: { label: "Kwit wywozowy", description: "Kwit wywozowy drewna z lasu (np. Lasy Państwowe: nadleśnictwo, leśnictwo, sortyment, m³)." },
  KWIT_WAGOWY: { label: "Kwit wagowy", description: "Wydruk / kwit z wagi: masa brutto, tara, netto, nr rejestracyjny." },
  NIEZNANY: { label: "Nie rozpoznano", description: "Dokument innego typu albo nieczytelny." }
};

export const DOC_TYPE_KEYS = /** @type {DocType[]} */ (Object.keys(DOC_TYPES));

/** @type {FieldDef[]} */
export const FIELDS = [
  { key: "docNumber", label: "Numer", kind: "text", hint: "Numer dokumentu dokładnie jak na dokumencie. Kwit wywozowy: numer kwitu z GÓRY dokumentu (wiersz „nr …” pod tytułem, np. 7/202636843/1019).", erp: "operation.no / input.extDoc / transport.runs[].kwit" },
  { key: "docDate", label: "Data", kind: "date", hint: "Data dokumentu (WZ/PZ: data wystawienia lub wysyłki; kwit wagowy: data ważenia).", erp: "operation.docDate" },
  { key: "time", label: "Godzina", kind: "time", hint: "Godzina ważenia (kwit wagowy), jeśli jest.", erp: "—" },
  { key: "supplier", label: "Dostawca", kind: "text", hint: "Dostawca — tylko jeśli jest wpisany na dokumencie (pole „Dostawca” / „Sprzedawca”).", erp: "purchase.supplierId (partners)" },
  { key: "recipient", label: "Odbiorca", kind: "text", hint: "Odbiorca — tylko jeśli jest wpisany na dokumencie (pole „Odbiorca” / „Nabywca” / „Nazwa i adres odbiorcy”).", erp: "sale.buyerId (partners) / magazyn docelowy" },
  { key: "product", label: "Towar", kind: "text", hint: "Nazwa towaru (kwit wagowy).", erp: "productId (products)" },
  { key: "quantity", label: "Ilość", kind: "quantity", hint: "Ilość z jednostką. WZ/PZ: MP, m3 albo t (np. 62,60 mp). Kwit wywozowy: ilość m3 z tabeli / sekcji transportu (kolumna „Masa[m3]”, „Razem”), np. 17,50 m3.", erp: "qty + unit (MP / m3 / t)" },
  { key: "grossWeight", label: "Masa brutto", kind: "weight", hint: "Masa brutto z jednostką (kg lub t) — kwit wagowy.", erp: "weightManual (kwit wagowy)" },
  { key: "tareWeight", label: "Tara", kind: "weight", hint: "Masa tary z jednostką (kg lub t) — kwit wagowy.", erp: "—" },
  { key: "netWeight", label: "Masa netto", kind: "weight", hint: "Masa netto z jednostką (kg lub t) — kwit wagowy.", erp: "sale.weightT / transport.runs[].weightT" },
  { key: "vehicleReg", label: "Nr rejestracyjny", kind: "plate", hint: "Numer rejestracyjny pojazdu (sam numer, bez nazwy firmy — np. z „PY 30536 - Lander Agro” tylko PY 30536).", erp: "transport.runs[].reg / fleet.vehicles[].reg" },
  { key: "trailerReg", label: "Naczepa / przyczepa", kind: "plate", hint: "Numer rejestracyjny naczepy (kwit wagowy).", erp: "—" },
  { key: "driver", label: "Kierowca", kind: "text", hint: "Imię i nazwisko kierowcy (kwit wagowy), jeśli wpisane.", erp: "transport.runs[].driver / fleet.drivers" },
  { key: "forestDistrict", label: "Nadleśnictwo", kind: "text", hint: "Nadleśnictwo (kwit wywozowy, wiersz „Nadleśnictwo”).", erp: "production.ndl" },
  { key: "forestRange", label: "Leśnictwo", kind: "text", hint: "Leśnictwo (kwit wywozowy, wiersz „Nazwa leśnictwa”).", erp: "production.lesnictwo" }
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
/** @type {Record<string, FieldDef>} */
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

/**
 * Pola odczytywane dla danego typu dokumentu — w sekcjach i w kolejności wyświetlania.
 * Pola spoza listy typu nie są pokazywane ani oceniane (zostają null).
 * @type {Record<DocType, { title: string, fields: string[] }[]>}
 */
export const TYPE_SECTIONS = {
  KWIT_WYWOZOWY: [
    { title: "Kwit", fields: ["docNumber", "forestDistrict", "forestRange"] },
    { title: "Transport", fields: ["vehicleReg", "quantity"] }
  ],
  WZ: [
    { title: "Dokument", fields: ["docDate", "supplier", "recipient"] },
    { title: "Transport", fields: ["vehicleReg", "quantity"] }
  ],
  PZ: [
    { title: "Dokument", fields: ["docDate", "supplier", "recipient"] },
    { title: "Transport", fields: ["vehicleReg", "quantity"] }
  ],
  KWIT_WAGOWY: [
    { title: "Kwit", fields: ["docNumber", "docDate", "time", "supplier", "recipient", "product"] },
    { title: "Ważenie", fields: ["grossWeight", "tareWeight", "netWeight"] },
    { title: "Transport", fields: ["vehicleReg", "trailerReg", "driver"] }
  ],
  NIEZNANY: [
    { title: "Dokument", fields: ["docNumber", "docDate", "supplier", "recipient", "forestDistrict", "forestRange"] },
    { title: "Transport", fields: ["vehicleReg", "quantity"] }
  ]
};

/** Płaska lista pól typu (kolejność wyświetlania). */
/** @type {Record<DocType, string[]>} */
export const FIELDS_BY_TYPE = /** @type {any} */ (Object.fromEntries(Object.entries(TYPE_SECTIONS).map(([t, secs]) => [t, secs.flatMap(s => s.fields)])));

/** Pola odczytywane dla typu (nieznany typ → NIEZNANY). */
export function fieldsFor(docType) {
  return FIELDS_BY_TYPE[/** @type {DocType} */ (docType)] || FIELDS_BY_TYPE.NIEZNANY;
}

/** Dozwolone jednostki ilości dla typu (null = bez ograniczeń). */
/** @type {Partial<Record<DocType, string[]>>} */
export const QUANTITY_UNITS = { KWIT_WYWOZOWY: ["m3"], WZ: ["MP", "m3", "t"], PZ: ["MP", "m3", "t"] };

/* ------------------------------------------------------------------ */
/* Schemat JSON odpowiedzi providera AI (structured outputs)           */
/* ------------------------------------------------------------------ */

const nullableString = { type: ["string", "null"] };
const confidence = { type: ["number", "null"], description: "Pewność odczytu 0.0–1.0; null gdy wartość jest null." };
const bbox = {
  type: ["array", "null"],
  items: { type: "number" },
  description: "Ramka fragmentu na zdjęciu [x0, y0, x1, y1] znormalizowana 0.0–1.0 (lewy górny róg = 0,0); null gdy brak wartości."
};

function fieldSchema(def) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "bbox"],
    properties: {
      value: Object.assign({}, nullableString, { description: def.hint + " Null, jeśli tego nie ma na dokumencie albo jest nieczytelne." }),
      confidence,
      bbox
    }
  };
}

/** Schemat JSON wyniku ekstrakcji (wspólny dla wszystkich providerów AI). */
export function extractionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["docType", "fields", "rawText", "notes"],
    properties: {
      docType: {
        type: "object",
        additionalProperties: false,
        required: ["value", "confidence", "evidence"],
        properties: {
          value: { type: "string", enum: DOC_TYPE_KEYS },
          confidence: { type: "number", description: "Pewność rozpoznania typu 0.0–1.0." },
          evidence: Object.assign({}, nullableString, { description: "Krótko: na jakiej podstawie (np. nagłówek „WZ”)." })
        }
      },
      fields: {
        type: "object",
        additionalProperties: false,
        required: FIELD_KEYS,
        properties: Object.fromEntries(FIELDS.map(f => [f.key, fieldSchema(f)]))
      },
      rawText: Object.assign({}, nullableString, { description: "Pełny odczytany tekst dokumentu (OCR), linia po linii." }),
      notes: Object.assign({}, nullableString, { description: "Uwagi o jakości zdjęcia / nieczytelnych miejscach; null gdy brak." })
    }
  };
}

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
  { key: "docNumber", label: "Numer", kind: "text", hint: "Numer dokumentu dokładnie jak na dokumencie (np. 458/10/2026, WZ/012/09/2026, nr kwitu).", erp: "operation.no / input.extDoc / transport.runs[].kwit" },
  { key: "docDate", label: "Data", kind: "date", hint: "Data wystawienia dokumentu (dla kwitu wagowego: data ważenia).", erp: "operation.docDate" },
  { key: "time", label: "Godzina", kind: "time", hint: "Godzina z dokumentu (np. ważenia lub wywozu), jeśli jest.", erp: "—" },
  { key: "supplier", label: "Dostawca / sprzedawca", kind: "text", hint: "Firma przekazująca towar (na PZ dostawca, na kwicie wywozowym nadleśnictwo-sprzedawca).", erp: "purchase.supplierId (partners)" },
  { key: "recipient", label: "Odbiorca", kind: "text", hint: "Firma odbierająca towar / nabywca.", erp: "sale.buyerId (partners)" },
  { key: "warehouse", label: "Magazyn", kind: "text", hint: "Magazyn wystawiający lub przyjmujący, jeśli jest podany.", erp: "operation.whId (warehouses)" },
  { key: "product", label: "Towar / sortyment", kind: "text", hint: "Nazwa towaru lub sortymentu (np. Zrębka drzewna, S2AP, drewno opałowe).", erp: "productId (products)" },
  { key: "quantity", label: "Ilość", kind: "quantity", hint: "Ilość z jednostką dokładnie jak na dokumencie (np. 68,40 MP, 24,5 m3, 12,3 t).", erp: "qty + unit (MP / m3 / t)" },
  { key: "grossWeight", label: "Masa brutto", kind: "weight", hint: "Masa brutto z jednostką (kg lub t).", erp: "weightManual (kwit wagowy)" },
  { key: "tareWeight", label: "Tara", kind: "weight", hint: "Masa tary z jednostką (kg lub t).", erp: "—" },
  { key: "netWeight", label: "Masa netto", kind: "weight", hint: "Masa netto z jednostką (kg lub t).", erp: "sale.weightT / transport.runs[].weightT" },
  { key: "vehicleReg", label: "Samochód (nr rej.)", kind: "plate", hint: "Numer rejestracyjny pojazdu (ciągnika / samochodu).", erp: "transport.runs[].reg / fleet.vehicles[].reg" },
  { key: "trailerReg", label: "Naczepa / przyczepa", kind: "plate", hint: "Numer rejestracyjny naczepy lub przyczepy.", erp: "—" },
  { key: "driver", label: "Kierowca", kind: "text", hint: "Imię i nazwisko kierowcy.", erp: "transport.runs[].driver / fleet.drivers" },
  { key: "carrier", label: "Przewoźnik", kind: "text", hint: "Firma transportowa / przewoźnik.", erp: "transport.external.company (carriers)" },
  { key: "loadingPlace", label: "Miejsce załadunku", kind: "text", hint: "Miejsce załadunku / pochodzenia (np. oddział leśny, plac).", erp: "production.investSite / place" },
  { key: "deliveryPlace", label: "Miejsce dostawy", kind: "text", hint: "Miejsce rozładunku / dostawy.", erp: "transport.place" },
  { key: "forestDistrict", label: "Nadleśnictwo", kind: "text", hint: "Nazwa nadleśnictwa (kwit wywozowy).", erp: "production.ndl" },
  { key: "forestRange", label: "Leśnictwo", kind: "text", hint: "Nazwa leśnictwa (kwit wywozowy) albo leśnictwo dopisane na WZ / PZ (np. „L. Kuźnia”).", erp: "production.lesnictwo" },
  { key: "declaredWeight", label: "Masa wyliczona (deklarowana)", kind: "weight", hint: "Masa podana na dokumencie jako wyliczona / szacunkowa (np. na kwicie wywozowym „waga drewna obliczona … wynosi 12950,00 kg”), NIE wynik ważenia.", erp: "weightMode: auto — tylko porównanie" },
  { key: "contractNumber", label: "Nr umowy", kind: "text", hint: "Numer umowy (np. „Nr umowy nadl.”).", erp: "—" },
  { key: "eudrReference", label: "Nr referencyjny EUDR", kind: "text", hint: "Numer referencyjny deklaracji EUDR, jeśli jest.", erp: "— (do rozbudowy: identyfikowalność drewna)" },
  { key: "issuedBy", label: "Wystawił / wydał", kind: "text", hint: "Imię i nazwisko osoby wystawiającej / wydającej (pole „Wystawił”, „Wydający dokument”, „Wydał”). Sam nieczytelny podpis = null.", erp: "audyt (opis)" },
  { key: "receivedBy", label: "Odebrał / odbierający", kind: "text", hint: "Imię i nazwisko osoby odbierającej (pole „Odebrał”, „Odbierający”). Sam nieczytelny podpis = null.", erp: "transport.runs[].driver (po potwierdzeniu)" }
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
/** @type {Record<string, FieldDef>} */
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

/** Pola typowe dla danego typu dokumentu — kolejność wyświetlania. Pozostałe pola są pokazywane, jeśli mają wartość. */
/** @type {Record<DocType, string[]>} */
export const FIELDS_BY_TYPE = {
  WZ: ["docNumber", "docDate", "warehouse", "recipient", "product", "quantity", "vehicleReg", "trailerReg", "driver", "carrier", "deliveryPlace", "issuedBy", "receivedBy"],
  PZ: ["docNumber", "docDate", "warehouse", "supplier", "product", "quantity", "vehicleReg", "trailerReg", "driver", "carrier", "loadingPlace", "issuedBy", "receivedBy"],
  KWIT_WYWOZOWY: ["docNumber", "docDate", "time", "supplier", "forestDistrict", "forestRange", "loadingPlace", "product", "quantity", "declaredWeight", "recipient", "carrier", "vehicleReg", "trailerReg", "driver", "contractNumber", "eudrReference", "issuedBy", "receivedBy"],
  KWIT_WAGOWY: ["docNumber", "docDate", "time", "supplier", "recipient", "product", "grossWeight", "tareWeight", "netWeight", "vehicleReg", "trailerReg", "driver", "issuedBy"],
  NIEZNANY: ["docNumber", "docDate", "supplier", "recipient", "product", "quantity", "vehicleReg", "driver"]
};

/** Kolejność pól do wyświetlenia: najpierw typowe dla typu, potem pozostałe z wartością. */
export function displayOrder(docType, fields) {
  const base = FIELDS_BY_TYPE[/** @type {DocType} */ (docType)] || FIELDS_BY_TYPE.NIEZNANY;
  const extra = FIELD_KEYS.filter(k => !base.includes(k) && fields && fields[k] && fields[k].value != null);
  return [...base, ...extra];
}

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

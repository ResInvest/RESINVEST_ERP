// @ts-check
/* =========================================================================
   AI Document Scanner Test — dopasowanie do kartotek ResInvest ERP (TYLKO ODCZYT)

   Źródło: plik JSON w formacie danych ResInvest ERP (eksport / kopia JSON albo
   data/sample_data.json). Plik jest wyłącznie czytany — moduł nie ma połączenia
   z bazą SQLite serwera ERP i niczego w niej nie zmienia.

   Wynik to PODPOWIEDŹ („pasuje do kartoteki: …”), nie zmiana wartości odczytu.
   Wartość pola pozostaje dokładnie taka, jak na dokumencie.
   ========================================================================= */
import { plateKey } from "./normalize.mjs";

/** Klucze danych ERP, które moduł czyta. Konta użytkowników, operacje i księga są pomijane. */
export const MASTER_KEYS = ["products", "partners", "carriers", "fleet", "warehouses"];

/**
 * Kartoteki z obiektu danych ERP (tylko wybrane klucze). Bez dostępu do plików — działa w przeglądarce i w Node.
 * @param {any} j dane ERP (stan, kopia serwera z polem state albo eksport kartotek)
 * @param {string} [source] opis źródła
 */
export function loadMasterDataFromObject(j, source = "kartoteki") {
  if (!j || typeof j !== "object") return null;
  const src = j.state ? j.state : j; // kopia serwera ma dane w polu state
  const fleet = src.fleet || {};
  return {
    source,
    products: (src.products || []).map(p => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, active: p.active !== false })),
    partners: (src.partners || []).map(p => ({ id: p.id, name: p.name, role: p.role, city: p.city || "", lesnictwa: p.lesnictwa || [], active: p.active !== false })),
    carriers: (src.carriers || []).map(c => (typeof c === "string" ? { name: c } : { name: c.name })),
    vehicles: (fleet.vehicles || []).map(v => ({ id: v.id, name: v.name, reg: v.reg || "" })),
    drivers: (fleet.drivers || []).map(d => ({ id: d.id, name: d.name })),
    warehouses: (src.warehouses || []).map(w => ({ id: w.id, code: w.code, name: w.name }))
  };
}

const LEGAL = /\b(sp(ółka)?\.?\s*z\s*o\.?\s*o\.?|s\.?\s*a\.?|s\.?\s*c\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|b\.?\s*v\.?|gmbh)\b/gi;

/** Tekst do porównań: małe litery, bez polskich znaków, form prawnych i interpunkcji. */
export function simplify(s) {
  return String(s || "").toLowerCase()
    .replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Podobieństwo 0..1: Dice na bigramach znaków + premia za zawieranie całej nazwy. */
export function similarity(a, b) {
  const x = simplify(a), y = simplify(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = s => { const g = new Map(); const t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const gx = grams(x), gy = grams(y);
  let inter = 0, nx = 0, ny = 0;
  for (const v of gx.values()) nx += v;
  for (const v of gy.values()) ny += v;
  for (const [k, v] of gx) inter += Math.min(v, gy.get(k) || 0);
  let score = 2 * inter / (nx + ny);
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) score = Math.max(score, 0.85);
  return Math.round(score * 1000) / 1000;
}

/** Nazwa magazynu bez słów ogólnych („magazyn”, „RiC”) — „RiC Magazyn Zabrze” ≈ „RiC Zabrze”. */
export function warehouseName(s) {
  return simplify(s).replace(/\b(magazyn\w*|ric|plac|sklad)\b/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Podpowiedzi integracyjne wynikające z dopasowania do kartotek (tylko informacja dla użytkownika).
 * @param {string} docType
 * @param {Record<string, { kind: string, label: string }>} matches
 * @returns {string[]}
 */
export function integrationHints(docType, matches) {
  const out = [];
  if (docType === "WZ" && matches.recipient && matches.recipient.kind === "warehouse") {
    out.push(`Odbiorcą jest magazyn własny: ${matches.recipient.label.replace(/ — magazyn własny$/, "")}. W ResInvest ERP taki ruch to zwykle przesunięcie MM, a nie sprzedaż WZ — do decyzji przy integracji.`);
  }
  return out;
}

function best(value, list, nameOf, min) {
  let top = null;
  for (const item of list) {
    const s = similarity(value, nameOf(item));
    if (s >= min && (!top || s > top.score)) top = { item, score: s };
  }
  return top;
}

/**
 * Podpowiedzi dopasowania pól odczytu do kartotek ERP.
 * @param {Record<string, import("./normalize.mjs").FieldResult>} fields
 * @param {ReturnType<typeof loadMasterDataFromObject>} md
 * @returns {Record<string, { kind: string, id: string|null, label: string, score: number }>}
 */
export function matchMasterData(fields, md, min = 0.6) {
  /** @type {Record<string, { kind: string, id: string|null, label: string, score: number }>} */
  const out = {};
  if (!md) return out;
  const val = k => (fields[k] && fields[k].value ? fields[k].value : null);
  const put = (key, kind, hit, label) => { if (hit) out[key] = { kind, id: hit.item.id || null, label: label(hit.item), score: hit.score }; };

  if (val("product")) put("product", "product", best(val("product"), md.products, p => p.name, min), p => `${p.name} (${p.code}, ${p.unit})`);
  if (val("supplier")) put("supplier", "partner", best(val("supplier"), md.partners.filter(p => p.role !== "buyer"), p => p.name, min), p => p.name);
  if (val("recipient")) {
    // odbiorcą bywa magazyn własny (np. „RiC Magazyn Zabrze”) — porównujemy też z magazynami
    const partner = best(val("recipient"), md.partners.filter(p => p.role !== "supplier"), p => p.name, min);
    const wh = best(warehouseName(val("recipient")), md.warehouses, w => warehouseName(w.name), min);
    if (wh && (!partner || wh.score > partner.score)) put("recipient", "warehouse", wh, w => `${w.name} (${w.code}) — magazyn własny`);
    else put("recipient", "partner", partner, p => p.name);
  }
  // „PGL LP NADLEŚNICTWO RUDY RACIBORSKIE” (kwit) ≈ „Nadleśnictwo Rudy Raciborskie” (kartoteka)
  const ndl = s => String(s).replace(/^(pgl\s+lp\s+)?nadle[sś]nictwo\s+/i, "");
  if (val("forestDistrict")) put("forestDistrict", "partner", best(ndl(val("forestDistrict")), md.partners.filter(p => /nadle/i.test(p.name)), p => ndl(p.name), min), p => p.name);
  if (val("driver")) put("driver", "driver", best(val("driver"), md.drivers, d => d.name, 0.8), d => d.name);
  if (val("forestRange")) {
    for (const p of md.partners) {
      const l = (p.lesnictwa || []).find(x => similarity(x, val("forestRange")) >= 0.8);
      if (l) { out.forestRange = { kind: "lesnictwo", id: p.id, label: `${l} — ${p.name}`, score: similarity(l, val("forestRange")) }; break; }
    }
  }
  for (const k of ["vehicleReg", "trailerReg"]) {
    const v = val(k);
    if (!v) continue;
    const hit = md.vehicles.find(x => x.reg && plateKey(x.reg) === plateKey(v));
    if (hit) out[k] = { kind: "vehicle", id: hit.id, label: `${hit.reg} — ${hit.name}`, score: 1 };
  }
  return out;
}

// @ts-check
/* =========================================================================
   AI Document Scanner Test — ocena jakości rozpoznania względem wzorca

   Wzorzec (*.expected.json) to ręczny odczyt dokumentu przez człowieka:
     { image, docType, fields: { pole: "wartość" | null | { value, alternatives?, uncertain? } } }
   Pola nieopisane we wzorcu oczekują null (nie ma ich na dokumencie).

   Porównanie odbywa się na wartościach znormalizowanych (data ISO, ilość + jednostka,
   masa w kg, nr rej. bez spacji, tekst bez wielkości liter / polskich znaków / form prawnych).

   Kategorie wyniku pola:
     correct       — zgodne (także: oczekiwano null i jest null),
     wrong         — inna wartość,
     missed        — wartość jest na dokumencie, a provider zwrócił null,
     hallucinated  — na dokumencie brak (null), a provider coś wpisał  ← najgroźniejsze („zgadywanie”),
     uncertain     — wzorzec niepewny (nieczytelny dla człowieka) — poza dokładnością.
   ========================================================================= */
import { FIELD_KEYS, FIELD_BY_KEY } from "./schema.mjs";
import { normalizeField, plateKey } from "./normalize.mjs";
import { simplify, similarity } from "./master-data.mjs";

/**
 * @typedef {{ value: string|null, alternatives?: string[], uncertain?: boolean, note?: string }} ExpectedField
 * @typedef {{ image: string, docType: string, fields: Record<string, string|null|ExpectedField>, note?: string }} Expected
 */

/** @returns {ExpectedField} */
export function expectedField(spec) {
  if (spec === undefined || spec === null) return { value: null };
  if (typeof spec === "string") return { value: spec };
  return { value: spec.value == null ? null : String(spec.value), alternatives: spec.alternatives || [], uncertain: !!spec.uncertain, note: spec.note };
}

/** Klucz porównania wartości pola (po normalizacji modułu). */
export function compareKey(key, value) {
  if (value == null) return null;
  const f = normalizeField(key, { value, confidence: 1, bbox: null }, "manual");
  if (f.value == null) return null;
  const kind = FIELD_BY_KEY[key].kind;
  const n = f.normalized;
  if (kind === "date" || kind === "time") return n || simplify(f.value);
  if (kind === "plate") return plateKey(f.value);
  if (kind === "quantity") return n ? `${n.amount}|${n.unit || ""}` : simplify(f.value);
  if (kind === "weight") return n && n.kg != null ? `${n.kg}kg` : simplify(f.value);
  return simplify(f.value);
}

/** Czy wartość przewidziana pasuje do oczekiwanej (lub alternatywy)? Tekst: tolerancja drobnych różnic OCR. */
export function matches(key, predicted, exp) {
  const p = compareKey(key, predicted);
  const candidates = [exp.value, ...(exp.alternatives || [])].filter(v => v != null);
  if (p == null) return exp.value == null || (exp.alternatives || []).includes(/** @type {any} */ (null));
  if (!candidates.length) return false;
  const textual = FIELD_BY_KEY[key].kind === "text";
  return candidates.some(c => {
    const e = compareKey(key, c);
    if (e === p) return true;
    return textual && similarity(String(predicted), String(c)) >= 0.9;
  });
}

/**
 * @param {Expected} expected
 * @param {{ docType: { value: string, confidence: number|null }, fields: Record<string, { value: string|null, confidence: number|null }> }} result  wynik po normalizacji
 */
export function scoreDocument(expected, result) {
  const rows = [];
  const counts = { correct: 0, wrong: 0, missed: 0, hallucinated: 0, uncertain: 0 };
  const present = { total: 0, correct: 0 }, absent = { total: 0, correct: 0 };
  for (const key of FIELD_KEYS) {
    const exp = expectedField(expected.fields[key]);
    const got = result.fields[key] ? result.fields[key].value : null;
    let status;
    if (exp.uncertain) status = "uncertain";
    else if (matches(key, got, exp)) status = "correct";
    else if (got == null) status = "missed";
    else if (exp.value == null && !(exp.alternatives || []).length) status = "hallucinated";
    else status = "wrong";
    counts[status]++;
    if (status !== "uncertain") {
      const bucket = exp.value != null ? present : absent;
      bucket.total++;
      if (status === "correct") bucket.correct++;
    }
    if (status !== "correct" || exp.value != null) rows.push({ key, status, expected: exp.value, alternatives: exp.alternatives || [], got, confidence: result.fields[key] ? result.fields[key].confidence : null, note: exp.note || null });
  }
  const scored = counts.correct + counts.wrong + counts.missed + counts.hallucinated;
  return {
    image: expected.image,
    docTypeExpected: expected.docType, docTypeGot: result.docType.value, docTypeConfidence: result.docType.confidence,
    docTypeCorrect: expected.docType === result.docType.value,
    counts, present, absent,
    accuracy: scored ? Math.round(counts.correct / scored * 1000) / 1000 : null,
    presentAccuracy: present.total ? Math.round(present.correct / present.total * 1000) / 1000 : null,
    nullDiscipline: absent.total ? Math.round(absent.correct / absent.total * 1000) / 1000 : null,
    rows
  };
}

/** Podsumowanie wielu dokumentów + kalibracja: średnia pewność poprawnych vs błędnych odczytów. */
export function summarize(docs) {
  const t = { correct: 0, wrong: 0, missed: 0, hallucinated: 0, uncertain: 0 };
  const present = { total: 0, correct: 0 }, absent = { total: 0, correct: 0 };
  const confOk = [], confBad = [];
  for (const d of docs) {
    for (const k of Object.keys(t)) t[k] += d.counts[k];
    present.total += d.present.total; present.correct += d.present.correct;
    absent.total += d.absent.total; absent.correct += d.absent.correct;
    for (const r of d.rows) {
      if (r.confidence == null || r.got == null) continue;
      if (r.status === "correct") confOk.push(r.confidence); else if (r.status === "wrong" || r.status === "hallucinated") confBad.push(r.confidence);
    }
  }
  const avg = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 1000) / 1000 : null);
  const scored = t.correct + t.wrong + t.missed + t.hallucinated;
  return {
    documents: docs.length,
    docTypeAccuracy: docs.length ? Math.round(docs.filter(d => d.docTypeCorrect).length / docs.length * 1000) / 1000 : null,
    /** najważniejszy wskaźnik: odsetek pól obecnych na dokumencie odczytanych poprawnie */
    presentFieldAccuracy: present.total ? Math.round(present.correct / present.total * 1000) / 1000 : null,
    /** odsetek pól nieobecnych na dokumencie, które pozostały null (brak zgadywania) */
    nullDiscipline: absent.total ? Math.round(absent.correct / absent.total * 1000) / 1000 : null,
    fieldAccuracy: scored ? Math.round(t.correct / scored * 1000) / 1000 : null,
    counts: t,
    avgConfidenceCorrect: avg(confOk),
    avgConfidenceWrong: avg(confBad)
  };
}

// @ts-check
/* =========================================================================
   AI Document Scanner Test — provider MOCK (bez sieci, bez kluczy)

   Do testów interfejsu, API i normalizacji. NIE wykonuje OCR.
   * Dla przykładowych zdjęć z katalogu samples/ zwraca przygotowany wynik
     (fixture dopasowany po SHA-256 pliku) — z ramkami odpowiadającymi
     rzeczywistemu położeniu tekstu na wygenerowanym obrazie.
   * Dla każdego innego zdjęcia zwraca uczciwie „NIEZNANY” i same null —
     nigdy nie udaje rozpoznania.
   Wynik jest oznaczony meta.simulated = true i pokazywany w interfejsie
   jako „wynik symulowany”.
   ========================================================================= */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FIELD_KEYS } from "../schema.mjs";

/** Pusty wynik: wszystkie pola null. */
export function emptyExtraction(notes) {
  return {
    docType: { value: "NIEZNANY", confidence: 0, evidence: null },
    fields: Object.fromEntries(FIELD_KEYS.map(k => [k, { value: null, confidence: null, bbox: null }])),
    rawText: null,
    notes
  };
}

/** @param {string} dir katalog z plikami *.json (fixture) */
export function loadFixtures(dir) {
  /** @type {Map<string, { file: string, raw: any }>} */
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter(x => x.endsWith(".json")).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (j && /^[0-9a-f]{64}$/.test(j.sha256) && j.raw) map.set(j.sha256, { file: j.file, raw: j.raw });
  }
  return map;
}

/**
 * @param {{ fixturesDir: string, delayMs?: number }} opts
 * @returns {import("./provider.mjs").Provider}
 */
export function createMockProvider(opts) {
  const fixtures = loadFixtures(opts.fixturesDir);
  return {
    name: "mock",
    status() {
      return {
        name: "mock", label: `Mock — wyniki symulowane (${fixtures.size} przykładów, bez OCR)`, configured: true,
        model: null, simulated: true, coordinates: true, reason: null
      };
    },
    async analyze(input) {
      const started = Date.now();
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      const hit = fixtures.get(input.sha256);
      const raw = hit ? structuredClone(hit.raw) : emptyExtraction("Provider MOCK nie wykonuje OCR — rozpoznaje tylko przykładowe zdjęcia z katalogu samples/. Aby analizować własne zdjęcia, skonfiguruj provider „anthropic” (ANTHROPIC_API_KEY w server.env).");
      return { raw, meta: { model: null, servedBy: null, simulated: true, usage: null, ms: Date.now() - started, fixture: hit ? hit.file : null } };
    }
  };
}

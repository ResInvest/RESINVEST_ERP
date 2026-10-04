// @ts-check
/* =========================================================================
   AI Document Scanner Test — przebieg analizy i korekty

   ZDJĘCIE → kontrola pliku → provider (OCR/AI) → normalizacja i walidacja →
   podpowiedzi z kartotek ERP (odczyt) → zapis w izolowanym magazynie testowym.

   Żaden krok nie tworzy dokumentu PZ/WZ, ruchu magazynowego ani transportu.
   ========================================================================= */
import { inspectImage, EXT_BY_MIME } from "./image.mjs";
import { normalizeExtraction, normalizeField, crossCheck } from "./normalize.mjs";
import { DOC_TYPE_KEYS, FIELD_BY_KEY } from "./schema.mjs";
import { matchMasterData, integrationHints } from "./master-data.mjs";
import { ProviderError } from "./providers/provider.mjs";

export class InputError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 400) { super(message); this.name = "InputError"; this.status = status; }
}

/**
 * @param {{ provider: import("./providers/provider.mjs").Provider, store: import("./store.mjs").ScanStore, masterData: any, cfg: import("./config.mjs").ScannerConfig }} ctx
 * @param {{ buffer: Buffer, originalName?: string|null, hintType?: string|null, signal?: AbortSignal }} input
 */
export async function analyzeDocument(ctx, input) {
  const img = inspectImage(input.buffer, { maxBytes: ctx.cfg.maxUploadBytes, minSide: ctx.cfg.minSide, maxSide: ctx.cfg.maxSide });
  if (!img.ok) throw new InputError(img.error, img.status);
  const hintType = input.hintType && input.hintType !== "AUTO" ? String(input.hintType).toUpperCase() : null;
  if (hintType && !DOC_TYPE_KEYS.includes(/** @type {any} */ (hintType))) throw new InputError("Nieznany typ dokumentu: " + hintType);

  const { raw, meta } = await ctx.provider.analyze({ buffer: input.buffer, mime: img.mime, sha256: img.sha256, hintType, signal: input.signal });
  let result;
  try { result = normalizeExtraction(raw, { hintType }); }
  catch (e) { throw new ProviderError(e instanceof Error ? e.message : String(e), { status: 502, code: "BAD_SHAPE", cause: e }); }

  const erpMatches = matchMasterData(result.fields, ctx.masterData);
  result.hints = [...result.hints, ...integrationHints(result.docType.value, erpMatches)];
  return ctx.store.create({
    image: { buffer: ctx.cfg.keepImages ? input.buffer : null, mime: img.mime, ext: EXT_BY_MIME[img.mime], width: img.width, height: img.height, sha256: img.sha256, originalName: sanitizeName(input.originalName) },
    provider: Object.assign({ name: ctx.provider.name }, meta),
    hintType,
    result,
    erpMatches
  });
}

/**
 * Ręczna korekta odczytu (tylko w magazynie testowym). Pole skorygowane dostaje source = "manual".
 * @param {{ store: import("./store.mjs").ScanStore, masterData: any }} ctx
 * @param {string} id
 * @param {{ rev: number, docType?: string, fields?: Record<string, string|null>, reviewer?: string, markReviewed?: boolean }} patch
 */
export async function applyCorrection(ctx, id, patch) {
  if (!patch || typeof patch !== "object") throw new InputError("Brak danych korekty.");
  const reviewer = String(patch.reviewer || "").trim().slice(0, 80) || "tester";
  const fields = patch.fields || {};
  for (const k of Object.keys(fields)) {
    if (!FIELD_BY_KEY[k]) throw new InputError("Nieznane pole: " + k);
    const v = fields[k];
    if (v !== null && typeof v !== "string") throw new InputError(`Pole ${k}: wartość musi być tekstem albo null.`);
    if (typeof v === "string" && v.length > 300) throw new InputError(`Pole ${k}: tekst jest za długi.`);
  }
  if (patch.docType !== undefined && !DOC_TYPE_KEYS.includes(/** @type {any} */ (patch.docType))) throw new InputError("Nieznany typ dokumentu.");

  return ctx.store.update(id, Number(patch.rev), rec => {
    const at = new Date().toISOString();
    const r = rec.result;
    if (patch.docType !== undefined && patch.docType !== r.docType.value) {
      rec.corrections.push({ at, by: reviewer, field: "docType", was: r.docType.value, now: patch.docType });
      r.docType = { value: patch.docType, confidence: 1, evidence: "korekta ręczna", source: "manual" };
    }
    for (const [k, v] of Object.entries(fields)) {
      const cur = r.fields[k];
      const next = normalizeField(k, { value: v, confidence: 1, bbox: cur ? cur.bbox : null }, "manual");
      if ((cur ? cur.value : null) === next.value) continue;
      rec.corrections.push({ at, by: reviewer, field: k, was: cur ? cur.value : null, now: next.value });
      r.fields[k] = next;
    }
    const cc = crossCheck(r.docType.value, r.fields);
    rec.erpMatches = matchMasterData(r.fields, ctx.masterData);
    r.checks = cc.warnings;
    r.hints = [...cc.hints, ...integrationHints(r.docType.value, rec.erpMatches)];
    if (patch.markReviewed) rec.status = "REVIEWED";
  });
}

function sanitizeName(n) {
  if (!n) return null;
  return String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
}

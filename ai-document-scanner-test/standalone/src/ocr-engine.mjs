// @ts-check
/* =========================================================================
   Silnik OCR w przeglądarce — Tesseract.js (open source, Apache-2.0), BEZ internetu.

   Wszystkie zasoby są osadzone w pliku HTML (budowa: tools/build-standalone.mjs):
     #asset-worker  — worker Tesseract.js (base64),
     #asset-core    — rdzeń WebAssembly z obsługą SIMD (gzip + base64),
     #asset-pol     — polskie dane językowe (gzip + base64).
   Z zasobów tworzone są adresy blob: — nic nie jest pobierane z sieci i nic nie wychodzi
   na zewnątrz (dodatkowo blokuje to Content-Security-Policy: connect-src bez adresów sieciowych).
   ========================================================================= */
import { pageFromTesseract } from "../../src/ocr-extract.mjs";

/** @type {Promise<any>|null} */
let workerPromise = null;
/** @type {(p: { status: string, progress: number }) => void} */
let progressCb = () => {};

/** @param {string} id */
function assetBytes(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Brak zasobu ${id} w pliku programu.`);
  const b64 = (el.textContent || "").trim();
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
async function gunzipText(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("Przeglądarka jest zbyt stara (brak DecompressionStream). Użyj aktualnej przeglądarki Chrome, Edge, Firefox lub Safari.");
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Uruchomienie silnika (raz; kolejne wywołania używają tego samego workera). */
export function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const T = /** @type {any} */ (window).Tesseract;
    if (!T) throw new Error("Brak biblioteki Tesseract.js w pliku programu.");
    progressCb({ status: "Przygotowanie silnika OCR", progress: 0.05 });
    const workerJs = new TextDecoder().decode(assetBytes("asset-worker"));
    const coreJs = await gunzipText(assetBytes("asset-core"));
    // Dane języka jako adres data: (Tesseract.js 7 źle obsługuje dane przekazane obiektem — używa ich jako nazwy).
    // Worker pobiera „<langPath>/pol.traineddata.gz”; część po „#” jest pomijana, więc trafia w osadzone dane.
    const polB64 = (document.getElementById("asset-pol")?.textContent || "").trim();
    if (!polB64) throw new Error("Brak danych języka polskiego w pliku programu.");
    const langPath = "data:application/octet-stream;base64," + polB64 + "#";
    // Rdzeń WebAssembly łączymy z workerem w jeden skrypt: przy otwarciu pliku z dysku (file://)
    // worker nie ma dostępu do innych adresów blob: strony, a gotowy global TesseractCore
    // sprawia, że worker niczego nie doładowuje (corePath nie jest używany).
    const workerUrl = URL.createObjectURL(new Blob([coreJs, "\n;\n", workerJs], { type: "text/javascript" }));
    const worker = await T.createWorker("pol", 1, {
      workerPath: workerUrl, corePath: "embedded-core.wasm.js", langPath, workerBlobURL: false, cacheMethod: "none", gzip: true,
      logger: m => { if (m && typeof m.progress === "number") progressCb({ status: statusPl(m.status), progress: m.progress }); },
      errorHandler: e => console.error("OCR:", e)
    });
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" });
    return worker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

function statusPl(s) {
  return ({
    "loading tesseract core": "Ładowanie silnika OCR",
    "initializing tesseract": "Uruchamianie OCR",
    "loading language traineddata": "Ładowanie języka polskiego",
    "initializing api": "Uruchamianie OCR",
    "recognizing text": "Rozpoznawanie tekstu"
  })[s] || s;
}

/**
 * Parametry przygotowania zdjęcia — dobrane testami na prawdziwych zdjęciach dokumentów z telefonu:
 * zmniejszanie gubi cyfry, rozciąganie kontrastu nie pomaga; dlatego przebieg 1 = oryginalny rozmiar,
 * przebieg 2 = powiększenie (do MAX_PIXELS — limit pamięci przeglądarek w telefonach).
 */
export const PREP = { minLong: 0, maxLong: 1e9, contrast: false };
export const MAX_PIXELS = 15e6;

/**
 * Przygotowanie zdjęcia dla OCR: obrót, skala (dłuższy bok ~ 2600–3400 px), skala szarości,
 * rozciągnięcie kontrastu. Zwraca canvas.
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} img @param {number} rotation 0/90/180/270
 * @param {{ minLong?: number, maxLong?: number, contrast?: boolean, scale?: number }} [opts]
 */
export function preprocess(img, rotation = 0, opts = {}) {
  const minLong = opts.minLong ?? PREP.minLong, maxLong = opts.maxLong ?? PREP.maxLong, contrast = opts.contrast ?? PREP.contrast;
  const w0 = "naturalWidth" in img ? img.naturalWidth : img.width, h0 = "naturalHeight" in img ? img.naturalHeight : img.height;
  const long = Math.max(w0, h0);
  let scale = opts.scale ?? (long < minLong ? Math.min(2, minLong / long) : long > maxLong ? maxLong / long : 1);
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (w0 * h0)));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const rot = ((rotation % 360) + 360) % 360;
  const canvas = document.createElement("canvas");
  canvas.width = rot % 180 ? h : w; canvas.height = rot % 180 ? w : h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(/** @type {any} */ (img), -w / 2, -h / 2, w, h);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height), d = id.data;
  // skala szarości + histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
  // rozciągnięcie kontrastu: 1% najciemniejszych → 0, 1% najjaśniejszych → 255
  const total = d.length / 4; let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
  if (!contrast) { lo = 0; hi = 255; }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, (d[i] - lo) * 255 / range)) | 0; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/**
 * Rozpoznanie tekstu na przygotowanym obrazie.
 * @param {HTMLCanvasElement} canvas @param {(p: { status: string, progress: number }) => void} onProgress
 */
export async function recognize(canvas, onProgress) {
  progressCb = onProgress || (() => {});
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return pageFromTesseract(data, canvas.width, canvas.height);
}

// @ts-check
/* =========================================================================
   AI Document Scanner Test — kontrakt providera OCR / AI

   Każdy provider (mock, Claude, w przyszłości np. Azure Document Intelligence,
   Google Document AI, lokalny Tesseract) implementuje ten sam interfejs i
   zwraca RawExtraction zgodny z src/schema.mjs → extractionJsonSchema().
   Reszta modułu (normalizacja, interfejs, zapis testowy) nie zależy od providera.

   Bezpieczeństwo: providery działają WYŁĄCZNIE na serwerze. Klucze API czytane
   są ze zmiennych środowiskowych / server.env i nigdy nie trafiają do odpowiedzi
   HTTP (status() zwraca tylko: nazwa, model, czy skonfigurowany).
   ========================================================================= */

/**
 * @typedef {object} AnalyzeInput
 * @property {Buffer} buffer      obraz dokumentu
 * @property {string} mime        image/jpeg | image/png | image/webp | image/gif
 * @property {string} sha256      skrót pliku (np. do dopasowania fixture w mocku)
 * @property {string|null} [hintType]  typ wskazany przez użytkownika (podpowiedź, nie wymuszenie)
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} ProviderMeta
 * @property {string|null} model
 * @property {boolean} simulated       true = wynik nie pochodzi z rzeczywistego OCR (mock)
 * @property {{ inputTokens?: number, outputTokens?: number }|null} [usage]
 * @property {string|null} [servedBy]  model, który faktycznie odpowiedział (np. po fallbacku)
 * @property {number} [ms]
 */

/**
 * @typedef {object} ProviderStatus
 * @property {string} name
 * @property {string} label
 * @property {boolean} configured
 * @property {string|null} model
 * @property {boolean} simulated
 * @property {boolean} coordinates   czy provider zwraca współrzędne fragmentów
 * @property {string|null} reason    dlaczego nieskonfigurowany (bez sekretów)
 */

/**
 * @typedef {object} Provider
 * @property {string} name
 * @property {() => ProviderStatus} status
 * @property {(input: AnalyzeInput) => Promise<{ raw: import("../normalize.mjs").RawExtraction, meta: ProviderMeta }>} analyze
 */

export class ProviderError extends Error {
  /**
   * @param {string} message  komunikat dla użytkownika (PL, bez sekretów)
   * @param {{ status?: number, code?: string, retryable?: boolean, cause?: unknown }} [opts]
   */
  constructor(message, opts = {}) {
    super(message, { cause: opts.cause });
    this.name = "ProviderError";
    this.status = opts.status || 502;
    this.code = opts.code || "PROVIDER_ERROR";
    this.retryable = !!opts.retryable;
  }
}

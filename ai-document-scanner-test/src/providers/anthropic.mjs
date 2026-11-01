// @ts-check
/* =========================================================================
   AI Document Scanner Test — provider Claude (Anthropic API, analiza obrazu)

   Jedno wywołanie Messages API: obraz (base64) + instrukcja + wymuszony schemat
   JSON odpowiedzi (structured outputs) → RawExtraction. Model odczytuje tekst
   (OCR), klasyfikuje typ dokumentu, wypełnia pola i podaje przybliżone ramki
   fragmentów (bbox) w układzie 0..1.

   Klucz: ANTHROPIC_API_KEY (zmienna środowiskowa albo server.env modułu) —
   czytany tylko tutaj, na serwerze. Nie jest logowany ani zwracany do przeglądarki.

   Fallback: przy odmowie klasyfikatora bezpieczeństwa API może przekierować
   żądanie na model zastępczy (fallbacks: "default"); który model odpowiedział,
   zapisujemy w meta.servedBy.
   ========================================================================= */
import { extractionJsonSchema, DOC_TYPES, FIELDS, TYPE_SECTIONS, isManualField } from "../schema.mjs";
import { ProviderError } from "./provider.mjs";

export const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Instrukcja systemowa — stała (bez dat i zmiennych), żeby nie psuć cache promptu. */
export function buildSystemPrompt() {
  const types = Object.entries(DOC_TYPES).map(([k, v]) => `- ${k}: ${v.description}`).join("\n");
  const fields = FIELDS.map(f => `- ${f.key} (${f.label}): ${f.hint}`).join("\n");
  const perType = Object.entries(TYPE_SECTIONS).filter(([k]) => k !== "NIEZNANY")
    .map(([k, secs]) => `- ${k}: ${secs.map(s => `${s.title}: ${s.fields.filter(f => !isManualField(k, f)).join(", ")}`).join(" | ")}`).join("\n");
  return `Jesteś modułem OCR systemu magazynowego firmy handlującej biomasą drzewną (zrębka, drewno, PKS) w Polsce.
Dostajesz zdjęcie JEDNEGO dokumentu: PZ, WZ, kwitu wywozowego drewna albo kwitu wagowego. Zdjęcie może być krzywe, prześwietlone lub częściowo nieczytelne; dokument może być wypełniony odręcznie.

Zadanie:
1. Odczytaj cały tekst dokumentu (rawText).
2. Określ typ dokumentu (docType) na podstawie tego, co jest na dokumencie (nagłówek, układ, pola):
${types}
3. Wypełnij WYŁĄCZNIE pola właściwe dla rozpoznanego typu (pozostałe pola: value = null, confidence = null, bbox = null):
${perType}
   Dla NIEZNANY wypełnij to, co pasuje z powyższych.
Opis pól:
${fields}

Zasady (obowiązkowe):
- Przepisuj wartości DOKŁADNIE tak, jak są na dokumencie (cyfry, separatory, jednostki, wielkość liter numerów rejestracyjnych). Nie przeliczaj jednostek, nie formatuj dat inaczej, nie poprawiaj pisowni nazw.
- Jeżeli informacji NIE MA na dokumencie albo jest nieczytelna — value = null, confidence = null, bbox = null. Nie zgaduj, nie wyliczaj (np. nie licz netto z brutto i tary), nie uzupełniaj z wiedzy ogólnej ani z innych pól.
- Dostawcę i odbiorcę wpisuj tylko wtedy, gdy są wpisani w polach dokumentu („Dostawca”, „Odbiorca”, „Nabywca”, „Nazwa i adres odbiorcy”). Nadruk / pieczątka wystawcy formularza to nie jest wpisany dostawca.
- Kwit wywozowy: docNumber = numer kwitu z góry dokumentu (wiersz „nr …” pod tytułem), forestDistrict = wiersz „Nadleśnictwo”, forestRange = „Nazwa leśnictwa”, vehicleReg = „Nr rej. pojazdu”, quantity = łączna ilość m3 (kolumna „Masa[m3]” / wiersz „Razem”) — nie liczba sztuk i nie masa w kg.
- WZ / PZ: quantity = ilość wydana / przyjęta w MP, m3 albo t, z jednostką z kolumny „j.m.” / „Jedn.” (np. „62,60 mp”). Jeśli ilość wpisano w niewłaściwą kolumnę (np. „KTM / symbol indeksu”), ale jest jednoznacznie powiązana z towarem i jednostką, odczytaj ją, obniż confidence i opisz to w notes.
- Numeracja WZ, PZ i kwitu wagowego jest wpisywana ręcznie przez użytkownika — dla tych typów docNumber = null.
- PZ: jeśli obok ilości w MP podano także tony (np. „62,60 mp / 20,5 t”), quantity = ilość w MP, netWeight = tony; w przeciwnym razie netWeight = null.
- Jednostka podana w nagłówku kolumny lub w osobnej kolumnie jest częścią dokumentu — dołącz ją do ilości (np. „17,50 m3”).
- vehicleReg: sam numer rejestracyjny — z pola „Środek transportu: PY 30536 - Lander Agro” tylko „PY 30536”.
- Daty przepisuj tak, jak napisano (np. „27.08.26r.”, „27/03/2026”).
- Znaki wodne aparatu (np. nazwa telefonu) i nadruki drukarni formularzy pomijaj.
- confidence (0.0–1.0) ma odzwierciedlać czytelność i jednoznaczność: ≥0.95 wyraźny druk i jednoznaczna etykieta; 0.8–0.95 drobne wątpliwości; 0.5–0.8 pismo odręczne, rozmazanie lub niepewne przypisanie pola; <0.5 domysł z fragmentu (lepiej wtedy null).
- bbox = [x0, y0, x1, y1] ramka OBEJMUJĄCA ODCZYTANĄ WARTOŚĆ (bez etykiety) we współrzędnych znormalizowanych do wymiarów zdjęcia: 0.0 = lewa / górna krawędź, 1.0 = prawa / dolna.
- Jeśli wskazano oczekiwany typ dokumentu, traktuj to jako podpowiedź — w docType podaj typ, który faktycznie widać na dokumencie.
- notes: krótkie uwagi o jakości zdjęcia lub nieczytelnych miejscach (po polsku), albo null.`;
}

/**
 * @param {{ apiKey?: string|null, model?: string, effort?: "low"|"medium"|"high"|"xhigh"|"max", timeoutMs?: number, maxRetries?: number, useFallback?: boolean, client?: any }} opts
 * @returns {import("./provider.mjs").Provider}
 */
export function createAnthropicProvider(opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const effort = opts.effort || "high";
  const useFallback = opts.useFallback !== false;
  const apiKey = opts.apiKey || null;
  /** @type {any} */
  let client = opts.client || null;
  /** @type {any} moduł SDK (klasy błędów); ładowany leniwie — provider mock działa bez niego */
  let sdk = null;
  const system = buildSystemPrompt();
  const schema = extractionJsonSchema();

  async function loadSdk() {
    if (sdk) return sdk;
    try { sdk = await import("@anthropic-ai/sdk"); }
    catch (e) { throw new ProviderError("Brak pakietu @anthropic-ai/sdk — uruchom „npm install” w katalogu modułu.", { status: 503, code: "SDK_MISSING", cause: e }); }
    return sdk;
  }

  async function getClient() {
    if (client) { await loadSdk().catch(() => null); return client; }
    if (!apiKey) throw new ProviderError("Provider Claude nie jest skonfigurowany: brak ANTHROPIC_API_KEY w server.env lub zmiennych środowiskowych.", { status: 503, code: "NOT_CONFIGURED" });
    const Anthropic = (await loadSdk()).default;
    client = new Anthropic({ apiKey, timeout: opts.timeoutMs || 180_000, maxRetries: opts.maxRetries == null ? 2 : opts.maxRetries });
    return client;
  }

  return {
    name: "anthropic",
    status() {
      const configured = !!(client || apiKey);
      return {
        name: "anthropic", label: "Claude (Anthropic API) — analiza obrazu", configured, model,
        simulated: false, coordinates: true,
        reason: configured ? null : "Brak ANTHROPIC_API_KEY (ustaw w server.env modułu — nigdy w przeglądarce)."
      };
    },
    async analyze(input) {
      const c = await getClient();
      const started = Date.now();
      const hint = input.hintType && input.hintType !== "AUTO" ? `Oczekiwany typ dokumentu (podpowiedź użytkownika): ${input.hintType}.` : "Typ dokumentu: rozpoznaj automatycznie.";
      /** @type {any} */
      const params = {
        model,
        max_tokens: 16000,
        system,
        thinking: { type: "adaptive" },
        output_config: { effort, format: { type: "json_schema", schema } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.mime, data: input.buffer.toString("base64") } },
            { type: "text", text: `${hint}\nOdczytaj dokument ze zdjęcia zgodnie z instrukcją i schematem.` }
          ]
        }]
      };
      if (useFallback) { params.betas = [FALLBACK_BETA]; params.fallbacks = "default"; }

      let res;
      try {
        res = await c.beta.messages.create(params, input.signal ? { signal: input.signal } : undefined);
      } catch (e) {
        throw mapApiError(e, sdk);
      }
      if (res.stop_reason === "refusal") {
        const cat = res.stop_details && res.stop_details.category ? ` (kategoria: ${res.stop_details.category})` : "";
        throw new ProviderError("Model odmówił analizy tego obrazu" + cat + ". Sprawdź, czy zdjęcie przedstawia dokument.", { status: 422, code: "REFUSAL" });
      }
      if (res.stop_reason === "max_tokens") throw new ProviderError("Odpowiedź modelu została ucięta (limit długości). Spróbuj zdjęcia jednego dokumentu.", { status: 502, code: "TRUNCATED", retryable: true });
      const text = (res.content || []).filter(b => b && b.type === "text").map(b => b.text).join("");
      if (!text) throw new ProviderError("Model nie zwrócił wyniku.", { status: 502, code: "EMPTY" });
      let raw;
      try { raw = JSON.parse(text); }
      catch (e) { throw new ProviderError("Model zwrócił niepoprawny JSON.", { status: 502, code: "BAD_JSON", cause: e }); }
      return {
        raw,
        meta: {
          model,
          servedBy: res.model || model,
          simulated: false,
          usage: res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : null,
          ms: Date.now() - started
        }
      };
    }
  };
}

/** Błędy SDK → komunikat dla użytkownika (bez szczegółów technicznych i sekretów). */
export function mapApiError(e, sdk) {
  if (e instanceof ProviderError) return e;
  const A = sdk && sdk.default ? sdk.default : null;
  const is = cls => !!(A && A[cls] && e instanceof A[cls]);
  // kolejność: od najbardziej szczegółowych klas (Timeout dziedziczy po Connection)
  if (is("APIUserAbortError")) return new ProviderError("Analiza przerwana.", { status: 499, code: "ABORTED", cause: e });
  if (is("APIConnectionTimeoutError")) return new ProviderError("Przekroczono czas oczekiwania na odpowiedź AI.", { status: 504, code: "TIMEOUT", retryable: true, cause: e });
  if (is("APIConnectionError")) return new ProviderError("Brak połączenia z usługą AI (sieć / proxy).", { status: 502, code: "NETWORK", retryable: true, cause: e });
  if (is("AuthenticationError") || is("PermissionDeniedError")) return new ProviderError("Klucz API został odrzucony (nieprawidłowy lub bez uprawnień).", { status: 502, code: "AUTH", cause: e });
  if (is("RateLimitError")) return new ProviderError("Przekroczono limit zapytań do usługi AI — spróbuj za chwilę.", { status: 429, code: "RATE_LIMIT", retryable: true, cause: e });
  if (is("BadRequestError") || is("UnprocessableEntityError")) return new ProviderError("Usługa AI odrzuciła żądanie (np. zbyt duży lub uszkodzony obraz).", { status: 422, code: "BAD_REQUEST", cause: e });
  if (is("InternalServerError")) return new ProviderError("Usługa AI jest chwilowo niedostępna.", { status: 503, code: "UPSTREAM", retryable: true, cause: e });
  if (is("APIError")) return new ProviderError(`Błąd usługi AI (HTTP ${e.status ?? "?"}).`, { status: 502, code: "API_ERROR", cause: e });
  return new ProviderError("Nieoczekiwany błąd usługi AI.", { status: 502, code: "UNKNOWN", cause: e });
}

# ResInvest ERP — AI Document Scanner Test

*Moduł eksperymentalny. Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

Izolowany moduł testowy, który sprawdza, czy da się automatycznie odczytać ze **zdjęcia** dokumenty:
**PZ**, **WZ**, **kwit wywozowy** i **kwit wagowy**.

```
ZDJĘCIE  →  ROZPOZNANIE (OCR / AI)  →  DANE (pola + pewność + podświetlenie na zdjęciu)  →  ręczna korekta
```

> **Tryb testowy.** Moduł **nie łączy się z bazą ResInvest ERP**, nie tworzy dokumentów PZ/WZ, ruchów
> magazynowych, transportów ani produkcji i nie zmienia stanów. Wyniki zapisuje wyłącznie w osobnym
> katalogu `data-test/` (oznaczone `testOnly: true`, `erpPosted: false`). Decyzja o integracji z ERP — po teście.

---

## 1. Co potrafi

| Funkcja | Opis |
|---|---|
| Przyjęcie zdjęcia | plik (JPEG / PNG / WEBP / GIF; HEIC z telefonu konwertuje przeglądarka), aparat telefonu (`capture=environment`), przeciągnij-i-upuść, przykłady |
| Przygotowanie obrazu | w przeglądarce: zmniejszenie dłuższego boku do 2400 px, korekta orientacji EXIF; na serwerze: kontrola sygnatury pliku, rozmiaru i rozdzielczości |
| OCR / analiza AI | provider **Claude (Anthropic API)** — jedno wywołanie z obrazem i wymuszonym schematem JSON; provider **mock** do testów bez sieci |
| Typ dokumentu | PZ, WZ, KWIT_WYWOZOWY, KWIT_WAGOWY albo NIEZNANY + pewność + uzasadnienie |
| Pola (19) | numer, data, godzina, dostawca, odbiorca, magazyn, towar, ilość + jednostka, masa brutto / tara / netto, samochód, naczepa, kierowca, przewoźnik, miejsce załadunku, miejsce dostawy, nadleśnictwo, leśnictwo |
| Pewność | dla typu i każdego pola (0–100%), kolory: ≥ 90% zielony, 75–89% bursztynowy, < 75% czerwony |
| Brak danych | `null` — pole puste z opisem „null — brak na dokumencie”; **nic nie jest zgadywane ani wyliczane** |
| Walidacja | daty, godziny, liczby w zapisie polskim, jednostki (MP, m3, t, kg), numery rejestracyjne; błędny format obniża pewność i daje ostrzeżenie |
| Kontrole krzyżowe | netto ≠ brutto − tara, tara > brutto, naczepa = samochód, brak odbiorcy na WZ / dostawcy na PZ, data z przyszłości — **tylko ostrzeżenia** |
| Zdjęcie obok danych | ramki odczytanych fragmentów; najechanie / fokus na polu podświetla fragment, kliknięcie ramki przenosi do pola; powiększenie |
| Ręczna korekta | edycja pól i typu, „Sprawdzający”, zapis z historią **było → jest**, ochrona przed nadpisaniem (rewizja), status „sprawdzone” |
| Kartoteki ERP (odczyt) | podpowiedź „Kartoteka ERP: …” — dopasowanie do produktów, kontrahentów, nadleśnictw/leśnictw, przewoźników, kierowców, pojazdów i magazynów z pliku JSON ERP; wartość odczytu się nie zmienia |
| Historia testów | lista wyników testowych, otwieranie, usuwanie (tylko dane testowe), eksport JSON |

## 2. Instalacja

Wymagania: **Node.js 22.13+** (ten sam co ResInvest ERP Serwer). Internet tylko dla providera Claude.

```bash
cd ai-document-scanner-test
npm install                 # @anthropic-ai/sdk + narzędzia deweloperskie
npm run build               # kontrole + dist/
npm run start:mock          # test bez klucza: http://127.0.0.1:8095
```

Windows: dwuklik `start-skaner-test.cmd` (używa Node.js z PATH albo z instalacji ResInvest ERP, otwiera przeglądarkę).

### Provider Claude (prawdziwy OCR)

1. Skopiuj `.env.example` → `config/server.env`.
2. Wpisz **testowy** klucz `ANTHROPIC_API_KEY=` (zalecany osobny workspace z limitem wydatków).
3. `npm start` — przy `provider: "auto"` serwer sam wybierze Claude, gdy klucz jest ustawiony.

Klucz czyta wyłącznie serwer. Nie trafia do przeglądarki, odpowiedzi API ani logów (sprawdzają to testy).

### Test z telefonu w sieci firmy

W `config/server.env`: `SCANNER_HOST=0.0.0.0` i `SCANNER_ACCESS_TOKEN=<długi losowy tekst>`.
Telefon otwiera `http://<ip-komputera>:8095/?token=<token>` (token zapisuje się w ciasteczku HttpOnly).
Bez tokenu serwer odmówi nasłuchu poza localhost.

## 3. Jak uruchomić test

1. `npm run start:mock` → kliknij przykład **WZ** — wynik jak w specyfikacji testu
   (WZ 98%, 458/10/2026 99%, 03.10.2026 99%, XYZ Sp. z o.o. 96%, Zrębka drzewna 97%, 68,40 MP 99%,
   WI12345 91%, W12345 86%, Jan Kowalski 78%).
2. **Kwit wagowy (uszkodzony)** — netto zalane: `null` + podpowiedź „brutto − tara = 25 140 kg — NIE wpisano”;
   godzina „9:5?” z ostrzeżeniem i obniżoną pewnością.
3. Własne zdjęcie z providerem mock → „NIEZNANY”, wszystkie pola `null` (mock nie udaje OCR).
4. Z kluczem Claude — zdjęcia prawdziwych dokumentów z telefonu; popraw błędy, zapisz korektę, porównaj
   w historii korekt, ile pól wymagało poprawy (to jest miara jakości do decyzji o integracji).

## 4. Polecenia

| Polecenie | Działanie |
|---|---|
| `npm start` | serwer (provider wg konfiguracji) |
| `npm run start:mock` | serwer z providerem mock |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`checkJs`, `strict`) na kodzie modułu (src, server, tools, public) |
| `npm test` | testy jednostkowe i API (`node --test`, bez sieci) |
| `npm run build` | kontrole (składnia, brak sekretów i CDN w interfejsie, identyfikatory, fixture) + `dist/` |
| `npm run test:e2e` | test przeglądarkowy (Playwright + Chromium, komputer i telefon 390 px) |
| `npm run verify` | wszystko powyżej po kolei |
| `npm run samples` | ponowne wygenerowanie przykładowych dokumentów i fixture |

## 5. Struktura

```
ai-document-scanner-test/
├─ config/scanner.config.json     konfiguracja (port, provider, limity, model, katalog danych testowych)
├─ .env.example                   wzór config/server.env (klucze — tylko serwer)
├─ server/scanner-server.mjs      serwer HTTP + API (127.0.0.1:8095)
├─ src/
│  ├─ schema.mjs                  typy dokumentów, pola, schemat JSON odpowiedzi AI
│  ├─ normalize.mjs               normalizacja, walidacja, pewność, kontrole krzyżowe
│  ├─ image.mjs                   kontrola obrazu (sygnatura, wymiary, rozmiar)
│  ├─ analyze.mjs                 przebieg analizy i korekty
│  ├─ store.mjs                   izolowany magazyn wyników testowych (zapis atomowy, rewizje)
│  ├─ master-data.mjs             dopasowanie do kartotek ERP (tylko odczyt pliku JSON)
│  ├─ config.mjs                  konfiguracja + ochrona izolacji katalogu danych
│  └─ providers/                  provider.mjs (kontrakt) · anthropic.mjs · mock.mjs · index.mjs
├─ public/                        interfejs (HTML/CSS/JS, bez bibliotek, CSP 'self')
├─ samples/                       fikcyjne dokumenty PNG + fixture mocka + kartoteki przykładowe ERP
├─ tests/                         *.test.mjs (jednostkowe, API) · e2e.cjs (przeglądarka)
├─ tools/                         build.mjs · make-samples.mjs
├─ docs/INTEGRACJA_ERP.md         analiza ERP, mapowanie pól, plan integracji
└─ start-skaner-test.cmd          start na Windows
```

## 6. API

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/health` | stan (`testOnly: true`, `erpConnected: false`) |
| GET | `/api/status` | provider (bez sekretów), limity, schemat pól, przykłady |
| POST | `/api/scan?hint=AUTO\|PZ\|WZ\|KWIT_WYWOZOWY\|KWIT_WAGOWY&name=…` | treść = bajty obrazu, `Content-Type: image/*` |
| GET | `/api/scans` · `/api/scans/:id` | lista / wynik |
| GET | `/api/scans/:id/image` · `/api/scans/:id/export` | obraz / JSON do pobrania |
| PATCH | `/api/scans/:id` | korekta `{ rev, fields: { pole: "tekst" \| null }, docType?, reviewer?, markReviewed? }` |
| DELETE | `/api/scans/:id` | usunięcie wyniku testowego |

Format pola w wyniku: `{ value, normalized, confidence, bbox: [x0,y0,x1,y1] (0..1) | null, warnings[], source: "ai" | "manual" }`.

## 7. Bezpieczeństwo danych

* Brak połączenia z bazą ERP; kartoteki ERP czytane z pliku JSON (bez kont użytkowników, operacji i księgi).
* Serwer odmawia startu, jeśli katalog danych testowych wygląda na katalog ERP (`resinvest.sqlite`, `data-server`).
* Zapis atomowy (plik tymczasowy → fsync → rename), rewizje z kontrolą konfliktów, zamrożony wynik AI (`aiResult`).
* Nasłuch tylko na localhost; poza nim wymagany token. Nagłówki CSP / nosniff / frame-ancestors, ochrona CSRF
  (Origin), limit analiz na minutę, limit rozmiaru, kontrola sygnatury pliku, identyfikatory odporne na path traversal.
* Zdjęcia dokumentów wysyłane do Anthropic API tylko przy providerze Claude (zgodnie z warunkami usługi).
  `keepImages: false` w konfiguracji wyłącza przechowywanie zdjęć w `data-test/`.

## 8. Ograniczenia (stan testu)

* **Pewność z modelu AI nie jest skalibrowaną miarą statystyczną** — to ocena modelu, obniżana przez walidację formatu.
  Kalibrację trzeba zmierzyć na prawdziwych dokumentach (historia korekt).
* Ramki (bbox) z Claude są **przybliżone** (model podaje współrzędne, to nie jest OCR słowo-po-słowie).
  Dokładne współrzędne słów dałby provider typu Azure Document Intelligence / Google Document AI.
* Pismo odręczne, pieczątki na tekście, mocno krzywe lub ciemne zdjęcia obniżają jakość.
* Jedno zdjęcie = jeden dokument, jedna strona, jedna pozycja towarowa (wiele pozycji — do rozbudowy schematu).
* Provider mock rozpoznaje wyłącznie przykłady z `samples/` (pewności w fixture są przykładowe).
* Moduł jednostanowiskowy (magazyn plików JSON); brak logowania użytkowników ERP — „Sprawdzający” to tekst.
* Koszt Claude (Opus 5.5, cennik $4 / $20 za 1 mln tokenów): orientacyjnie kilka–kilkanaście centów za zdjęcie —
  do potwierdzenia pomiarem (`usage` jest zapisywane w wyniku).
* Instalator Windows (Inno Setup) celowo pominięty dla modułu testowego — powstanie przy integracji z instalatorem ERP.

Szczegóły analizy ERP i plan integracji: [`docs/INTEGRACJA_ERP.md`](docs/INTEGRACJA_ERP.md).

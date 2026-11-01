# ResInvest ERP — Skaner dokumentów (test)

*Moduł eksperymentalny. Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

Sprawdza, czy da się automatycznie odczytać ze **zdjęcia**: **kwit wywozowy**, **WZ**, **PZ** i **kwit wagowy**.

```
ZDJĘCIE  →  ROZPOZNANIE (OCR)  →  DANE (pola + pewność + podświetlenie na zdjęciu)  →  ręczna korekta
```

> **Tryb testowy.** Nic nie trafia do ResInvest ERP: brak dokumentów PZ/WZ, ruchów magazynowych, zmian stanów.

## 0. Program próbny — jeden plik HTML (darmowy, bez internetu, bez kluczy)

**`standalone/AI_Skaner_Dokumentow.html`** (ok. 6,4 MB) — otwórz dwuklikiem w Chrome / Edge / Firefox / Safari
(komputer lub telefon). Nie wymaga instalacji, serwera, internetu ani kluczy API.

* **OCR:** Tesseract.js (open source, Apache-2.0) z polskimi danymi językowymi — działa w przeglądarce.
  Wszystkie zasoby są w pliku; program nie łączy się z siecią (blokuje to też nagłówek CSP w pliku).
* **Pola:**

  | Dokument | Odczyt OCR | Wpis ręczny |
  |---|---|---|
  | Kwit wywozowy | nr kwitu (góra), data, nadleśnictwo, leśnictwo · *Transport:* nr rej., ilość m3 | — |
  | WZ | data, dostawca, odbiorca (jeśli wpisani) · *Transport:* nr rej., ilość MP / m3 / t | **numer** |
  | PZ | jak WZ + **ilość [t]**, gdy tony stoją obok ilości w MP | **numer** |
  | Kwit wagowy | data, godzina, dostawca, odbiorca, towar, brutto / tara / netto, nr rej., naczepa, kierowca | **numer** |

* **Dokładny odczyt** (domyślnie): dwa przebiegi OCR (oryginał i powiększenie). Zgodne odczyty → wyższa pewność;
  rozbieżne → niska pewność i ostrzeżenie z obiema wersjami. Na WZ / PZ wartość musi wyjść w obu przebiegach.
* **Pewność:** z pewności znaków OCR; numery (kwitu, rejestracyjne) najwyżej 85% — nie mają sumy kontrolnej, jedna
  pomylona cyfra jest niewykrywalna; pola z formularzy WZ / PZ najwyżej 70% (pismo ręczne).
* Zdjęcie obok danych z **ramkami prawdziwych współrzędnych** słów OCR; obrót ↺ ↻; przykłady w pliku.
* **Wpis ręczny z podpowiedziami** z kartotek ERP (kontrahenci, magazyny, pojazdy, nadleśnictwa / leśnictwa);
  kartoteki można wczytać z kopii JSON ResInvest ERP (zapisywane są tylko kartoteki).
* **Historia testów** w przeglądarce (bez zdjęć — prywatność), historia korekt było → jest, eksport CSV / JSON.

### Wyniki na prawdziwych zdjęciach (3 dokumenty od użytkownika)

| Dokument | Typ | Pola poprawnie | Uwagi |
|---|---|---|---|
| Kwit wywozowy LP (wydruk termiczny, nieostre zdjęcie) | ✓ | 3 / 6 — data, nadleśnictwo, ilość m3 | nr kwitu i nr rej. z jedną pomyloną cyfrą (oznaczone „do sprawdzenia”), leśnictwo nieczytelne → puste |
| WZ zielona (odręczna) | ✓ | 0 / 4 | pismo ręczne — pola puste do wpisania (bez zgadywania) |
| WZ niebieska (odręczna) | ✓ | 0 / 3 | jw. |

Żadne pole nie zostało wpisane „z powietrza” (0 zgadnięć). **Ograniczenie darmowego OCR:** pisma odręcznego
Tesseract nie czyta — dla odręcznych WZ / PZ program rozpoznaje typ i ułatwia szybki wpis; drukowane kwity
odczytuje częściowo. Lepsze wyniki: zdjęcie z bliska, ostre, równo, przy dobrym świetle.

```bash
npm install && npm run build:standalone   # przebudowa pliku HTML (po zmianach w kodzie)
npm run test:standalone                   # test E2E pliku (file://, sieć zablokowana)
```

## Moduł serwerowy (opcjonalny, wymaga płatnego klucza AI)

Poniżej — moduł z serwerem Node.js i opcjonalnym providerem Claude (Anthropic API). **Nie jest potrzebny**
do programu próbnego; zostaje na wypadek przyszłej decyzji o płatnym, dokładniejszym rozpoznawaniu (także pisma ręcznego).

## 1. Co potrafi

| Funkcja | Opis |
|---|---|
| Przyjęcie zdjęcia | plik (JPEG / PNG / WEBP / GIF; HEIC z telefonu konwertuje przeglądarka), aparat telefonu (`capture=environment`), przeciągnij-i-upuść, przykłady |
| Przygotowanie obrazu | w przeglądarce: zmniejszenie dłuższego boku do 2400 px, korekta orientacji EXIF; na serwerze: kontrola sygnatury pliku, rozmiaru i rozdzielczości |
| OCR / analiza AI | provider **Claude (Anthropic API)** — jedno wywołanie z obrazem i wymuszonym schematem JSON; provider **mock** do testów bez sieci |
| Typ dokumentu | PZ, WZ, KWIT_WYWOZOWY, KWIT_WAGOWY albo NIEZNANY + pewność + uzasadnienie |
| Odczytywane pola | **Kwit wywozowy:** nr kwitu (góra dokumentu), nadleśnictwo, leśnictwo · *Transport:* nr rejestracyjny, ilość m3. **WZ / PZ:** data, dostawca i odbiorca (jeśli wpisani) · *Transport:* nr rejestracyjny, ilość (MP, m3 albo t). **Kwit wagowy:** nr, data, godzina, dostawca, odbiorca, towar, brutto / tara / netto, nr rej., naczepa, kierowca. Pola spoza listy typu nie są pokazywane ani zapisywane |
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

### Pomiar jakości na prawdziwych dokumentach

Katalog `eval/real/` zawiera **wzorce** (`*.expected.json`) — ręczny odczyt prawdziwych dokumentów
(kwit wywozowy LP, dwie odręczne WZ). Same zdjęcia **nie są w repozytorium** (podpisy, dane osób) —
skopiuj je do `eval/real/` pod nazwami z pola `"image"`. Następnie:

```bash
node tools/eval.mjs                     # provider wg konfiguracji (Claude, gdy jest klucz)
node tools/eval.mjs --only kwit         # jeden dokument
```

Oceniane są tylko pola odczytywane dla typu dokumentu. Raport: typ dokumentu, **pola z dokumentu odczytane poprawnie** (np. 4/5), **brak zgadywania**
(pola nieobecne na dokumencie, które zostały null), lista: ok / ✗ inna wartość / ∅ pominięte / !! wpisane bez
pokrycia / ? wzorzec niepewny, średnia pewność poprawnych i błędnych odczytów (kalibracja). Raport JSON trafia do
`eval/real/reports/` (poza git). Narzędzie nie zapisuje niczego w wynikach testowych ani w ERP.
Kolejne dokumenty: dodaj zdjęcie + `*.expected.json` (pola nieopisane = null; nieczytelne dla człowieka — `"uncertain": true`).

## 4. Polecenia

| Polecenie | Działanie |
|---|---|
| `npm start` | serwer (provider wg konfiguracji) |
| `npm run start:mock` | serwer z providerem mock |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`checkJs`, `strict`) na kodzie modułu (src, server, tools, public) |
| `npm test` | testy jednostkowe i API (`node --test`, bez sieci) |
| `npm run build` | kontrole (składnia, brak sekretów i CDN w interfejsie, identyfikatory, fixture) + `dist/` + program HTML |
| `npm run build:standalone` | tylko program próbny `standalone/AI_Skaner_Dokumentow.html` |
| `npm run test:standalone` | test E2E programu HTML (offline) + pomiar na zdjęciach z `eval/real` (jeśli są) |
| `npm run test:e2e` | testy przeglądarkowe modułu serwerowego i programu HTML (Playwright + Chromium, komputer i telefon 390 px) |
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
* Długie, wąskie wydruki termiczne (kwit wywozowy 1670×4094 px) są zmniejszane — drobny tekst może stracić
  czytelność; przy słabym wyniku fotografuj kwit bliżej (np. górną część z danymi).
* Wnioski z prawdziwych dokumentów (uwzględnione w instrukcji modelu, bez dodawania pól): jednostka bywa tylko
  w nagłówku kolumny („Masa[m3]”, „j.m.”), ilość bywa wpisana w złą kolumnę (KTM), „Środek transp.” łączy nr rej.
  i firmę (odczytywany jest sam numer), daty „27.08.26r.” i „27/03/2026 15:12:05”, WZ do magazynu własnego
  (np. „RiC Magazyn Zabrze”) to w ERP raczej przesunięcie MM (podpowiedź).
* Jedno zdjęcie = jeden dokument, jedna strona, jedna pozycja towarowa (wiele pozycji — do rozbudowy schematu).
* Provider mock rozpoznaje wyłącznie przykłady z `samples/` (pewności w fixture są przykładowe).
* Moduł jednostanowiskowy (magazyn plików JSON); brak logowania użytkowników ERP — „Sprawdzający” to tekst.
* Koszt Claude (Opus 5.5, cennik $4 / $20 za 1 mln tokenów): orientacyjnie kilka–kilkanaście centów za zdjęcie —
  do potwierdzenia pomiarem (`usage` jest zapisywane w wyniku).
* Instalator Windows (Inno Setup) celowo pominięty dla modułu testowego — powstanie przy integracji z instalatorem ERP.

Szczegóły analizy ERP i plan integracji: [`docs/INTEGRACJA_ERP.md`](docs/INTEGRACJA_ERP.md).

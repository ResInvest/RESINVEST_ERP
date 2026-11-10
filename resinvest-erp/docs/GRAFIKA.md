# ResInvest ERP 3.15 — przewodnik do zmian graficznych

Program to **jeden plik HTML** (`ResInvest_ERP.html`) składany z kodu źródłowego w `app/src/`.
Zmiany wprowadza się w źródłach, a nie w zbudowanym pliku (ma ok. 7 MB i jest nadpisywany przy każdej budowie).

## 1. Przygotowanie (raz)

1. Zainstaluj **Node.js 22** (https://nodejs.org) i edytor kodu, np. **Visual Studio Code**.
2. W folderze `resinvest-erp` uruchom w terminalu: `npm ci`

## 2. Praca nad wyglądem — podgląd na żywo

```bash
npm run dev                         # program firmowy  → ResInvest_ERP.html
npm run dev -- --edition demo       # wersja demonstracyjna → ResInvest_ERP_Demo.html (dane przykładowe, hasło demo1234)
npm run dev -- --edition premium    # edycja Premium → ResInvest_ERP_Premium.html
```

Otwórz zbudowany plik w Chrome / Edge. Po każdym zapisie pliku w `app/src` program buduje się sam (1–2 s) — odśwież stronę (F5).
Do zmian graficznych najwygodniejsza jest **wersja demonstracyjna** — ma dane we wszystkich ekranach.
Podgląd telefonu: F12 → ikona telefonu (Toggle device toolbar) → np. 390 × 844.

## 3. Gdzie co jest

| Co zmieniasz | Plik | Wskazówki |
|---|---|---|
| **Kolory, czcionki, odstępy, zaokrąglenia** | `app/src/styles.css` (wiersze 1–360) | Każdy motyw to blok `[data-theme="…"]{ --brand:…; --bg:…; … }`. Motyw domyślny „Perła” — blok `:root` na początku pliku. Zmiana zmiennej zmienia cały program. |
| Powłoka: panel boczny, górny pasek, menu | `styles.css` → sekcja „Powłoka” | Struktura HTML: `app/src/core.js` → `shell()`, lista menu: `NAV` |
| Przyciski, karty, pola, odznaki | `styles.css` → „Komponenty”, „Formularz” | klasy `.btn`, `.card`, `.kpi`, `.field`, `.ctrl`, `.badge` |
| Tabele (rejestry, raporty) | `styles.css` → „Tabele” | klasa `.tbl`; nagłówki dni/miesięcy w Operacjach: `.ops-grp` |
| Ekran logowania | `styles.css` → „Logowanie” (+ „Edycja Premium: ekran startowy”) | HTML: `core.js` → `Auth` (formularz `#login-form`) |
| Pulpit (kafle, wykresy) | `app/src/dashboard.js` + `styles.css` → „Pulpit 3.0”, „Wykresy” | |
| Ekrany modułów (Operacje, Dokumenty, Stany, Raporty, Kwit…) | `app/src/views.js` | każdy ekran: `Views.<nazwa> = { html(), bind() }` |
| Formularz nowej operacji | `app/src/form.js` + `styles.css` → „Formularz”, „Panel podsumowania” | |
| Administracja, Ustawienia → Wygląd | `app/src/admin.js` | |
| Wersja na telefon (układ wąskiego ekranu) | `styles.css` → „Responsywność” (`@media (max-width:…)`) | |
| Ikony w programie | `app/src/core.js` → obiekt `IC` (ścieżki SVG 24 × 24) | użycie: `ic("nazwa", rozmiar)` |
| Logo / ikona RiC (karta przeglądarki, instalator, telefon) | `app/assets/icons/ric.svg` | po zmianie: `NODE_PATH=$(npm root -g) node tools/make-icons.mjs` |
| Film powitalny i jego pierwsza klatka | `app/assets/intro.mp4`, `intro-poster.jpg` (Premium: `app/assets/premium/`) | |
| Wydruki i PDF dokumentów | `app/src/pdf.js` | |
| Teksty w języku czeskim / angielskim | `app/src/i18n.dNN.js` | nowy tekst polski → tłumaczenie w najnowszym `i18n.d28.js` |

### Nowy motyw kolorystyczny
1. Skopiuj blok np. `[data-theme="graphite"]{…}` w `styles.css`, zmień nazwę i kolory.
2. Dopisz go do `THEME_REGISTRY` w `app/src/engine.js` (nazwa, jasny/ciemny, 3 kolory próbki).
3. Dopisz identyfikator do listy w `app/src/index.template.html` (skrypt „przed pierwszym malowaniem”).
4. `npm run themes` — sprawdza kontrast (WCAG) każdego motywu.

## 4. Sprawdzenie przed oddaniem

```bash
npm run check && npm run i18n && npm run themes   # składnia, tłumaczenia (0 braków), kontrast motywów
npm test                                          # pełny zestaw testów (kilkanaście minut)
```
Testy e2e wyszukują elementy po identyfikatorach (`id="…"`) i atrybutach `data-…` — przy przebudowie ekranu zachowaj je
albo popraw odpowiedni test w `tests/`.

## 5. Budowa wersji do wydania

```bash
npm run build && npm run build:demo && node tools/build.mjs --edition premium   # trzy pliki HTML
npm run build:android                                                           # aplikacja na telefon (Android SDK)
# instalatory Windows: installer/build-installer.ps1 (Windows) albo installer/build-installer-wine.sh (Linux)
```

Aplikacja na telefon wyświetla ten sam program HTML — zmiany graficzne obejmują ją automatycznie
(tryb „Serwer firmy”: po aktualizacji serwera; tryby „Bez serwera” i „Demo”: po zbudowaniu nowego APK).

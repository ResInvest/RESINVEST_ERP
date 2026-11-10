# ResInvest ERP 3.12.0 — wersja demonstracyjna: EUDR i pulpit obrotu

Wersja do wglądu i naniesienia poprawek. Powstała z pliku **ResInvest ERP 3.11.0 TEST** — program jest ten sam, a dochodzą:

1. **Zakładka „EUDR — wylesianie”** — numery referencyjne DDS przy zakupach, numery dla odbiorców przy sprzedaży, profile dostawców, działki (geolokalizacja), raporty, eksport, ustawienia i plan wdrożenia.
2. **Pulpit → „Obrót miesiąca”** — karty „Zakupy od firm” i „Sprzedaż” obok siebie (po kliknięciu: kontrahenci i ich transakcje w MP, m³ i t), tabela „Lasy Państwowe” (nadleśnictwo → leśnictwo → transakcje, rozwijana) i rejestr ilości 6 miesięcy.

Analiza przepisów dla ResInvest Commodities i plan wdrożenia: [docs/EUDR_ResInvest_analiza_i_plan.md](docs/EUDR_ResInvest_analiza_i_plan.md).

## Uruchomienie

* **Windows:** dwuklik `start-eudr-demo.cmd` albo otwórz `dist/ResInvest_ERP_3.12.0_EUDR_DEMO.html` w Chrome / Edge / Firefox.
* Program działa offline z jednego pliku. Przy pierwszym uruchomieniu wczytuje **dane przykładowe**. Są w nich operacje z sierpnia–września 2026 r. oraz z poprzedniego i bieżącego miesiąca (względem dnia uruchomienia).
* Logowanie — konta demonstracyjne z ekranu logowania, hasło `demo1234`, np.:
  * `anna.gorska@resinvest.group` — kierownik (pełna edycja EUDR),
  * `adrian.wojciechowski@resinvest.group` — magazynier (numery referencyjne),
  * `beata.nowak@resinvest.group` — obserwator (tylko odczyt).
* Dane demo są zapisywane w przeglądarce pod **osobnymi kluczami** (`riw.v3.eudrdemo.*`), więc nie mieszają się z danymi ResInvest ERP 3.11 w tej samej przeglądarce.

## Budowa i testy

Wymaga Node.js 22.13+. Testy w przeglądarce wymagają Playwright z Chromium.

```bash
node tools/build.mjs            # base/ + src/ + config/ → dist/ResInvest_ERP_3.12.0_EUDR_DEMO.html
node --test tests/engine.test.mjs   # 17 testów silnika (na kodzie z dist/)
node tests/e2e.cjs              # 18 kroków w Chromium (komputer, obserwator, telefon 390 px), zrzuty: tests/out/
```

Budowa zmienia plik bazowy wyłącznie punktowo. Każda kotwica musi wystąpić dokładnie raz, a nowe klasy CSS nie mogą pokrywać się z klasami programu 3.11. Gdy któryś warunek nie jest spełniony, budowa przerywa się z błędem.

## Pliki

| Ścieżka | Zawartość |
|---|---|
| `base/` | ResInvest ERP 3.11.0 TEST — wejście budowy, bez zmian |
| `src/tradestats.js` | silnik zestawień obrotu (MP / m³ / t, grupy, rejestr miesięcy) |
| `src/eudr.js` | silnik EUDR: role, ocena kompletności, pula magazynu, komendy, audyt, eksport |
| `src/eudr-seed.js` | dane przykładowe obrotu i EUDR |
| `src/dashboard-premium.js`, `src/eudr-view.js`, `src/eudr.css` | widoki i style |
| `config/eudr.config.json` | konfiguracja: data stosowania, okres puli, wzorzec numeru |
| `data/przyklad-import-numerow.csv` | przykładowy plik do „Import numerów” |
| `tools/build.mjs` | budowa |
| `tests/` | testy silnika i testy w przeglądarce |
| `docs/` | analiza EUDR, plan wdrożenia, architektura |

## Znane ograniczenia demo

* Tryb lokalny (przeglądarka). W trybie serwerowym synchronizacja „samymi zmianami” musi jeszcze obsłużyć gałąź `eudr` — opis w planie wdrożenia.
* Nowe teksty są tylko po polsku. Po przełączeniu na CS / EN zostają po polsku.
* Numer DDS wpisuje się w zakładce EUDR. Pola w formularzu „Nowa operacja” i nadruku na WZ / PDF jeszcze nie ma.
* Wzorzec numeru referencyjnego tylko ostrzega i nie blokuje zapisu. Format trzeba potwierdzić w dokumentacji TRACES.
* Role zmienione wcześniej przez administratora nie dostają automatycznie nowych uprawnień EUDR.
* `toCSV` programu 3.11 nie neutralizuje formuł arkusza. Eksporty modułu EUDR i pulpitu robią to same, pozostałe eksporty 3.11 — nie.

# ResInvest ERP 3.16 — moduł EUDR: drewno surowe / TRACES

Moduł wspiera organizację obowiązków wynikających z rozporządzenia (UE) 2023/1115 (EUDR), zmienionego rozporządzeniem
(UE) 2025/2650, dla drewna surowego i produktów z drewna (np. drewno opałowe i zrębka, pozycja 4401). Program pomaga
zbierać informacje, dokumenty i decyzje. **Nie potwierdza zgodności z prawem.** Decyzje podejmują osoby odpowiedzialne w firmie.

## 1. Analiza architektury (stan przed wdrożeniem)

- **Jeden silnik, dwa środowiska uruchomieniowe**: logika domenowa w `app/src/*.js` działa w przeglądarce (tryb lokalny) i na serwerze Node.
- **Komendy z uprawnieniami**: `service.js` udostępnia komendy, a serwer zapisuje stan wierszami w SQLite / PostgreSQL.
- **Rejestr zmian**:
  - jeden dziennik audytu z łańcuchem SHA-256;
  - kopie zapasowe;
  - folder skanów z kopią.
- **Dane źródłowe w ERP**: ilości i ruchy pochodzą z dokumentów ERP (PZ, MM, produkcja, WZ), a dostawcy z kartoteki kontrahentów.

Wnioski projektowe:

1. **Brak drugiego systemu magazynowego.** Partia EUDR wskazuje dokument ERP i ilość. Saldo partii wynika z powiązań.
2. **Brak drugiej listy dostawców.** Dane EUDR dostawcy to rozszerzenie kontrahenta (`eudrSuppliers.partnerId`).
3. **Logika ERP bez zmian.** Moduł nie modyfikuje zatwierdzania operacji. Przyjęcia drewna bez partii pojawiają się
   w alertach i na liście „Przyjęcia do przypisania”, a kontrola wydania działa przy powiązaniu partii z WZ.
4. **Te same mechanizmy co reszta programu**: rejestr zmian, transakcja „wszystko albo nic”, kopie zapasowe, folder plików i PostgreSQL.

## 2. Plan wdrożenia (zrealizowane etapy)

| Etap | Zakres | Pliki |
|---|---|---|
| 1 | Silnik: partie, obowiązki, ocena, należyta staranność, DDS, audyt, szkolenia, testy lokalne, reguły | `app/src/eudr.js`, `app/src/eudr-content.js` |
| 2 | Integracja: komendy, rzutowanie widoku (magazyny), kolekcje wierszy bazy, dane przykładowe | `service.js`, `engine.js`, `server/core.mjs`, `seed.js` |
| 3 | Serwer: pliki dokumentów, klient SOAP V4, Centrum testów, złożenie i status DDS | `server/eudr-traces.mjs`, `server/eudr-routes.mjs` |
| 4 | Ekrany (13 pozycji menu modułu), raporty PDF / Excel, style responsywne | `app/src/eudr-view.js`, `styles.css` |
| 5 | Testy jednostkowe, serwerowe (atrapa usługi SOAP), e2e; dokumentacja | `tests/eudr316*.mjs`, `tests/e2e316eudr.cjs` |

## 3. Model danych (kolekcje wierszy — SQLite / PostgreSQL)

| Kolekcja | Zawartość |
|---|---|
| `eudrLots` | partia: `no` (EUDR/RRRR/NNNN), `wood` (gatunek PL/łac., rodzaj, CN, kraj, region, miejsce, okres pozyskania), `qty`/`m3`/`t`, `whId`, `productId`, `partnerId`, `acq` (sposób nabycia), `origin` (właściciel, działka, GPS, GeoJSON, ha, klasyfikacja kraju), `receipt` (PZ), `links` (PZ/MM/PROD/WZ/SPLIT/MERGE — wycofanie oznacza `void`, bez usuwania), `parents` (źródła), `dd` (etapy i zatwierdzenie), `status` |
| `eudrDocs` | dokument: rodzaj, numer, daty, partie, dostawca, `versions[]` (plik, typ, rozmiar, SHA-256, kto, kiedy), status sprawdzenia |
| `eudrDds` | wpis rejestru: `env` (ACCEPTANCE/PRODUCTION), rodzaj (własne, dostawcy, deklaracja uproszczona, symulacja), numer referencyjny i weryfikacyjny, UUID złożenia, status, partie, PZ/WZ, kroki procesu, historia |
| `eudrSuppliers` | dane EUDR kontrahenta: rola, kraj, adres, NIP, kontakt, umowa, status weryfikacji z opisem |
| `eudrAudits` | audyt 13 obszarów, wynik (wskaźnik), zamknięcie — po zamknięciu bez zmian |
| `eudrTraining` | przydział, lekcje, próby testu, ćwiczenia (numery SYM-), wewnętrzne potwierdzenie |
| `eudrTests` | przebiegi Centrum testów (środowisko, wyniki, tryb serwer / lokalnie) |

Konfiguracja: `state.config.eudr` przechowuje:
- profil firmy;
- tryb `env`;
- `releaseMode`;
- `products` (kody CN);
- `rules` (nadpisania reguł);
- `access` (role EUDR).

Nowe kolekcje są dodawane migracją `migrate()`, bez zmiany wersji schematu. Historia zmian to wpisy `entity: "eudr"` w dzienniku audytu, którego nie można usuwać.

## 4. Obowiązki i reguły

| Sposób nabycia | Rola firmy | Wymagane |
|---|---|---|
| pozyskanie własne / import / wywóz | Operator | należyta staranność (3 etapy), geolokalizacja, własny DDS przed wprowadzeniem lub wywozem |
| zakup od operatora z DDS | Pierwszy podmiot niższego szczebla | zebranie i przechowanie numeru referencyjnego i weryfikacyjnego DDS |
| zakup od mikro / małego producenta pierwotnego | Pierwszy podmiot niższego szczebla | identyfikator deklaracji uproszczonej |
| zakup od handlowca | Podmiot niższego szczebla / handlowiec | informacje o dostawcach i odbiorcach (5 lat) |
| kod CN spoza załącznika I | — | brak obowiązków EUDR |

- **Brak numeru dostawcy** daje ostrzeżenie. Nie blokuje przyjęcia ani wydania.
- **Blokada wydania** obejmuje tylko partie, za które firma odpowiada jako operator, i tylko po dacie stosowania obowiązków, w trybie „Blokuj”. Obejść ją może wyłącznie Administrator EUDR, z uzasadnieniem zapisanym w historii.
- **Daty stosowania**: 30.12.2026 dla dużych i średnich firm, a także mikro i małych objętych wcześniej EUTR; 30.06.2027 dla pozostałych mikro i małych.
- **Reguły** (daty, kody CN, dokumenty wymagane wg roli, data graniczna 31.12.2020, próg 4 ha, okres przechowywania 5 lat) są wbudowane jako wersja „2025/2650 — stan na 2026-11”. Można je nadpisać w Administracji (JSON z polem `version`) bez przebudowy programu.

## 5. Należyta staranność — zasady

1. **Etap 1 (art. 9)** to lista informacji. Program pokazuje podpowiedź, a zakończenie etapu wymaga oświadczenia osoby sprawdzającej. Pozycja „nie dotyczy” wymaga uzasadnienia.
2. **Etap 2 (art. 10)** to sześć kryteriów ryzyka i wynik z uzasadnieniem. Jeśli któreś kryterium ma poziom „wysokie”, ryzyka nie można uznać za znikome.
3. **Etap 3 (art. 11)** to środki ograniczające ryzyko i ocena ryzyka rezydualnego. Jest wymagany, gdy ryzyko jest nie-znikome.
4. **Wynik końcowy** zatwierdza Osoba odpowiedzialna albo Administrator EUDR. Wymaga uzasadnienia, potwierdzenia osobistego sprawdzenia i braku braków w danych. Program odnotowuje zasadę „czterech oczu”, gdy etap 1 wykonała inna osoba.
5. **Zmiana danych partii dopuszczonej** cofa ją do weryfikacji.

## 6. System EUDR (TRACES) — integracja

- **Adresy usług** pochodzą z oficjalnej dokumentacji API Komisji Europejskiej (V4) i są zapisane w `config/app.config.json` → `eudr.traces`:
  - ACCEPTANCE: `https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/`;
  - PRODUCTION: `https://eudr.webcloud.ec.europa.eu/tracesnt/`;
  - usługi: `ws/EUDRDueDiligenceStatementServiceV4` oraz `ws/EudrEchoService` (tylko ACCEPTANCE).
- **Uwierzytelnianie**: WS-Security UsernameToken z PasswordDigest = Base64(SHA-1(nonce + created + klucz)), znacznik czasu i nagłówek `WebServiceClientId`. Połączenie wyłącznie przez HTTPS. Limit to 5 wywołań na sekundę.
- **Dane dostępowe** są przechowywane wyłącznie w `server.env` serwera. Klucze to `EUDR_ACC_USERNAME`, `EUDR_ACC_AUTH_KEY`, `EUDR_ACC_CLIENT_ID` oraz `EUDR_PROD_*`.
  - Nie trafiają do przeglądarki, stanu programu, dziennika ani repozytorium.
  - Odpowiedzi serwera pokazują je zamaskowane.
  - ResInvest ERP nie zapisuje haseł EU Login.
- **Jak uzyskać dostęp**: zobacz Instrukcję 1 w module oraz rozdział „Acquiring Credentials” dokumentacji Komisji. Samo konto EU Login nie daje dostępu do API. Wsparcie: SANTE-TRACES@ec.europa.eu, temat zaczynający się od „EUDR API”.
- **Złożenie DDS** (`/api/eudr/traces/submit`) jest możliwe tylko dla własnego DDS:
  - środowisko wpisu musi być równe aktywnemu środowisku;
  - partie muszą być dopuszczone;
  - wywołanie w PRODUCTION wymaga potwierdzenia „PRODUKCJA”.
- **Status DDS** (`/api/eudr/traces/status`) można sprawdzić najwcześniej 1 godzinę po złożeniu.
- **Bez integracji** dostępny jest proces kontrolowany w 6 krokach:
  1. przygotowanie danych;
  2. eksport JSON / GeoJSON / XML (treść SubmitDdsRequest bez nagłówka bezpieczeństwa);
  3. otwarcie oficjalnego systemu;
  4. złożenie oświadczenia;
  5. wpisanie numerów;
  6. sprawdzenie statusu i powiązanie z WZ.
- **Rozdzielenie środowisk**:
  - wpisy mają `env`;
  - rejestr pokazuje tylko aktywne środowisko (drugie tylko do odczytu);
  - numer obecny w ewidencji ACCEPTANCE nie zostanie przyjęty w PRODUCTION;
  - symulacji nie zapisuje się w produkcji;
  - nie ma funkcji kopiowania między środowiskami.
- **Tryb bez serwera i wersje demonstracyjne** nie łączą się z Komisją i tego nie udają. Testy sieciowe są tam oznaczane jako pominięte.

## 7. Role EUDR

| Rola | Domyślnie dla | Zakres |
|---|---|---|
| Administrator EUDR | administrator programu | wszystko, tryb ACCEPTANCE / PRODUCTION, konfiguracja, reguły, role |
| Osoba odpowiedzialna | kierownik | partie, dokumenty, etapy i zatwierdzenie należytej staranności, DDS, audyt, szkolenia, testy |
| Magazynier | magazynier | partie z przyjęć, powiązania z dokumentami, podział / przetwarzanie, dokumenty |
| Kontroler dokumentacji | audytor | sprawdzanie dokumentów, statusy, etapy 1–3, audyt, dane dostawców |
| Podgląd | obserwator | odczyt i raporty |

Role zmienia Administrator EUDR w Administracji. Nadanie roli „Brak dostępu” ukrywa moduł.

## 8. Testy

```bash
node --test tests/eudr316.test.mjs          # silnik (14)
node --test tests/eudr-server316.test.mjs   # serwer, pliki, klient SOAP na atrapie usługi (4)
node tools/build.mjs --edition demo2 && node tests/e2e316eudr.cjs   # przeglądarka (30)
```

Test serwerowy uruchamia lokalną atrapę usługi SOAP i nie łączy się z Komisją Europejską. Adres atrapy podaje zmienna `EUDR_TEST_ENDPOINT`, która działa wyłącznie z adresem pętli zwrotnej (127.0.0.1 / localhost) i służy tylko testom automatycznym.

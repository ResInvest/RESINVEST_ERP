# Raport: ResInvest ERP 3.15 — przejście z SQLite na PostgreSQL

Data: 2026-11-10 · wersja programu: **3.15.0** · gałąź: `ccr-ed20f738-ngabkd` (PR #5, oparty na źródłach 3.14.0 z PR #2)

## 1. Podsumowanie

| Obszar | Stan |
|---|---|
| Tryb firmowy na PostgreSQL 14+ | gotowe, przetestowane na PostgreSQL 16.15 |
| Silnik, operacje, rejestry, poczta, uprawnienia, API, interfejs | **bez zmian** (te same pliki `app/src/*`, `mail.mjs`; zmieniona wyłącznie warstwa zapisu) |
| Migracja produkcyjna | **wbudowana w instalator 3.15** — wykonuje się na serwerze firmy przy aktualizacji (strona „Baza danych”) |
| SQLite | tryb awaryjny / jednostanowiskowy i punkt powrotu; plik produkcyjny nie jest zmieniany |
| Instalatory 3.15 (firma, gmail, otwarta) | zbudowane (Inno Setup 6.4.1 pod Wine), aktualizacja 3.14 → 3.15 sprawdzona pod Wine dwukrotnie |
| Licencja | `LICENSE` — wyraźnie nazwana **licencja niewyłączna** (patrz rozdz. 7) |
| Testy | wszystkie zielone (rozdz. 4) |

**Ważne:** bazy produkcyjnej firmy nie ma w środowisku, w którym powstawała ta wersja — migracja produkcyjna wykona się,
gdy instalator 3.15 zostanie uruchomiony na serwerze firmy (rozdz. 6). Do tego czasu dane produkcyjne nie zostały dotknięte.

## 2. Stan wyjściowy i zasada

Źródła 3.14.0 (PR #2) są bajt w bajt zgodne z serwerem z instalatora `ResInvestERP_SerwerFirma.exe` 3.14.0.
Cała trwałość jest w klasie `Store` (`server/core.mjs`): stan programu w pamięci serwera, każda komenda to jedna
transakcja (zmienione rekordy + rdzeń stanu + wpis dziennika z łańcuchem SHA-256), 9 tabel. Tryb OFFLINE (plik HTML
bez serwera) nie używa bazy serwera.

Zasada: logika 1:1 — wymieniony został wyłącznie sterownik pod `Store` (`server/db/*`). Ten sam scenariusz pracy
magazynu daje na obu silnikach identyczne wyniki komend, stan, tabele i łańcuch dziennika — bajt w bajt (test regresji).

## 3. Co zostało zrobione

* `server/db/` — warstwa bazy: SQLite (bez zmian zachowania) i PostgreSQL (sterownik `pg`, wywołania synchroniczne
  przez wątek roboczy — ta sama kolejność poleceń i transakcji co w SQLite).
* Ochrona danych przy pracy wielu użytkowników: jeden serwer zapisujący na bazę (blokada doradcza), kontrola rewizji
  przy każdym zapisie, ponowne połączenie po restarcie bazy, rozstrzyganie zapisu przerwanego zerwaniem połączenia
  (dziennik), ponowne wczytanie stanu z bazy po zapisie o nieznanym wyniku.
* Kopie zapasowe i `--restore` dla obu silników; kopia z PostgreSQL to spójny plik `.sqlite` w formacie serwera.
* `server/db-setup.mjs` + strona instalatora **„Baza danych”**: konto i baza programu (konto bez uprawnień administratora,
  hasło generowane), połączenie, `server.env`, migracja danych i przełączenie — wszystko albo nic dla danych.
* `tools/db-migrate.mjs` / `ResInvestERP-Migracja.cmd`: `plan`, `migrate --confirm`, `verify`, `rollback`.
* Wersja 3.15.0 (`engine.js`, `package.json`, `ResInvestERP.iss`, README „Nowe w 3.15.0”).
* Zmiany w istniejącym kodzie serwera: `core.mjs` i `riw-server.mjs` — po kilkadziesiąt wierszy (wybór silnika, zapis,
  kopia, przywracanie, blokada, `--db-setup`). Jeden nowy komunikat w słowniku CS/EN. `tools/loadtest.mjs` obsługuje tryb
  PostgreSQL. Pierwsza zależność npm projektu: `pg` (tryb SQLite jej nie ładuje).

## 4. Testy

### Dotychczasowe testy programu (wersja 3.15.0)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `i18n` (CS/EN: 0 braków, 0 nieużywanych), `themes`, `build`, `build:premium` | zaliczone |
| `npm run test:unit` | 203 / 203 |
| `npm run test:server` (SQLite) | 80 / 80 |
| `npm run test:e2e` (Chromium) | 382 + 32 + 11 + 21 + 13 = 459 / 459 |
| `e2e-server`, `e2e313`, `e2e314` z serwerem na **PostgreSQL** (3.14 + warstwa PG) | 66 / 66 |
| `tools/loadtest.mjs --users 40 --seconds 20` — SQLite / **PostgreSQL** | zaliczony / zaliczony, 0 błędów, 0 utraconych zapisów |

### Testy PostgreSQL (`npm run test:pg`) — 54 / 54

| Plik | Testy | Zakres |
|---|---|---|
| `db-dialect.test.mjs` | 9 | tłumaczenie SQL, zgodność z `node:sqlite`, typy, transakcje, dziennik tylko do dopisywania |
| `regression-engines.test.mjs` | 8 | scenariusz 37 komend (zakup z produkcją, WZ, odmowa ponad stan, produkcja, MM z przyjęciem i odmowami, korekta i jej wycofanie, anulowanie, wersje robocze, kartoteki, użytkownicy, planer, powiadomienia, wydruki, inwentaryzacja z zamknięciem) — wyniki, stan, tabele i stany magazynowe identyczne na obu silnikach |
| `migration.test.mjs` | 9 | plan, migracja, nienaruszone źródło, odmowy, atomowość, wycofanie, przywracanie, starsza baza |
| `db-setup.test.mjs` | 7 | strona „Baza danych”: nowa instalacja, aktualizacja z migracją, ponowna instalacja, konflikt danych, błędne hasło, konto administratora odrzucone, hasła ze znakami specjalnymi, kopia „przed aktualizacją” |
| `server-pg.test.mjs` | 13 | API, wielu użytkowników, kopie, druga instancja serwera, zerwane połączenie, konflikt rewizji, 401/403, role, wstrzyknięcie SQL, blokada konta, wykrycie ręcznej zmiany danych, restart |
| `resilience-pg.test.mjs` | 6 | zerwanie połączenia przed i w chwili zatwierdzania, baza niedostępna, niepewny wynik zapisu |
| `load-pg.test.mjs` | 2 | 24 użytkowników × 12 zapisów równocześnie na obu silnikach |

### Instalator pod Wine — aktualizacja 3.14 → 3.15 (dwa przebiegi, drugi na czystym systemie)

1. Oryginalny `ResInvestERP_SerwerFirma.exe` 3.14.0 zainstalowany po cichu; baza SQLite z danymi wytworzonymi kodem 3.14
   (dane przykładowe + 400 operacji: rewizja 417, 411 operacji, 401 wpisów dziennika, konta, dziennik logowań).
2. Kreator 3.15 przeklikany: licencja niewyłączna, strona „Baza danych” (walidacja pustych haseł działa), strona „Poczta”.
3. Wynik: konto `resinvest_app` i baza `resinvest` utworzone, **1936 wierszy przeniesionych, rewizja 417, 401 wpisów
   dziennika, 411 operacji, zgodność wszystkich tabel potwierdzona**, `DB_DRIVER=postgres`, kopie `…-manual.sqlite`
   (sprzed instalacji) i `…-przed-aktualizacja-3_14_0.sqlite` w `backups`.
4. Serwer 3.15 (node.exe z instalatora, pod Wine) na PostgreSQL: `/api/health` → `version 3.15.0, db postgres, integrity true`;
   logowanie użytkownikami z danych 3.14, 412 operacji widocznych dla administratora, nowa operacja zapisana jako `WZ/401/11/2026`.
5. W folderze programu brak odwołań do narzędzi AI; zainstalowane `server/db`, `tools/db-migrate.mjs`, `node_modules/pg`,
   `ResInvestERP-Migracja.cmd`.

### Duża baza (15 000 operacji ≈ 10 lat pracy)

| Pomiar | SQLite | PostgreSQL |
|---|---|---|
| Rozmiar bazy | 91 MB | 53 MB |
| Start serwera: wczytanie stanu + kontrola spójności | 1,9 s | 2,1 s |
| Migracja z kontrolą (45 207 wierszy) | — | 15 s |
| Kopia zapasowa | — | 3,5 s |
| 40 stanowisk otwiera program jednocześnie (curl, gzip) | — | 40 / 40 w 3,1 s; pamięć serwera ok. 580 MB |

`tools/loadtest.mjs --preload 15000` kończy się błędem klienta testowego na **obu** silnikach: jeden proces Node rozpakowuje
naraz 40 × 73 MB pełnego stanu. To ograniczenie narzędzia, nie serwera (te same pobrania przez `curl` przechodzą).

## 5. Błędy wykryte i naprawione

| # | Błąd | Wykryty przez | Poprawka | Ponowny test |
|---|---|---|---|---|
| 1 | Tłumacz SQL brał `AS IDENTITY` za alias kolumny | testy migracji | aliasy rozpoznawane tylko w zapisie camelCase | migracja 9/9 |
| 2 | Login ze znakiem NUL: błąd 500 na PostgreSQL zamiast 401 | test wstrzyknięć | tekst obcinany na znaku NUL jak w SQLite | serwer 13/13 |
| 3 | Limity czasu warstwy PG zależne od zegara systemowego | test regresji | zegar monotoniczny | regresja 8/8 |
| 4 | Utracone potwierdzenie zapisu + baza niedostępna: stan w pamięci mógł się rozjechać z bazą | test odporności | rozstrzygnięcie w dzienniku, komunikat „sprawdź zapis”, wczytanie stanu z bazy | odporność 6/6 |
| 5 | Wartości tekstowe ze znakiem NUL w SQLite | test migracji | raport podaje ich liczbę; przenoszona jest wartość widoczna dla programu | migracja 9/9 |
| 6 | `tools/loadtest.mjs` padał w trybie PostgreSQL (brak pliku `resinvest.sqlite`) | test obciążeniowy projektu | rozmiar 0, gdy pliku nie ma | loadtest na obu silnikach |
| 7 | Sprawdzenie „czy w SQLite są dane” zostawiało obok bazy puste pliki `-wal` / `-shm` | test strony „Baza danych” | otwarcie w trybie niezmiennym (`immutable`) | db-setup 7/7 |
| 8 | Kopia „przed-aktualizacja-3_14_0” powstawała w folderze roboczym migracji i była usuwana | aktualizacja pod Wine | kopia kierowana do `backups` | db-setup 7/7, ponowna aktualizacja pod Wine |

## 6. Migracja produkcyjna — jak ją wykonać

1. Zainstalować **PostgreSQL 14+** na serwerze firmy (instalator EDB; zalecany 16/17), zapamiętać hasło konta `postgres`.
2. Uruchomić `ResInvestERP_SerwerFirma.exe` 3.15 na komputerze serwera ERP.
3. Na stronie **„Baza danych”**: adres i port PostgreSQL (domyślnie `127.0.0.1:5432`), hasło konta `postgres`.
4. Odczytać okno z wynikiem: liczba wierszy, rewizja, operacje, „zgodność wszystkich tabel potwierdzona”.
5. Po starcie serwera: `ResInvestERP-Kontrola.cmd` (spójność OK), zalogować się i sprawdzić ostatnie operacje.
6. Zachować `C:\ProgramData\ResInvestERP\resinvest.sqlite` i kopie z `backups` co najmniej do pierwszego zamknięcia miesiąca.

Niepowodzenie w kroku 4 nie zmienia danych: serwer pracuje dalej na SQLite. Powrót z PostgreSQL do SQLite (także
z danymi wprowadzonymi już w PostgreSQL): `docs/POSTGRESQL.md`, rozdz. 5.

## 7. Licencja

Program nie miał licencji MIT — `LICENSE` była już licencją własnościową z udzieleniem ResInvest Commodities licencji
niewyłącznej (pkt 2). „MIT” występuje wyłącznie przy składnikach stron trzecich (Node.js, sterownik `pg`) — ich licencji
nie można zmienić i pozostają bez zmian. Plik `LICENSE` (oraz `eudr-demo/LICENSE` i `ai-document-scanner-test/LICENSE`)
zawiera teraz wyraźnie nazwaną **LICENCJĘ NIEWYŁĄCZNĄ**: podstawa prawna (art. 67 ust. 1 i art. 74 ustawy o prawie
autorskim), Licencjodawca i Licencjobiorca, pola eksploatacji, czas nieoznaczony, zakaz przenoszenia i sublicencji,
pierwszeństwo odrębnej umowy. Nowe w treści: **czas nieoznaczony** i wyliczenie pól eksploatacji, zakaz najmu
i użyczenia oraz uzupełniona lista składników stron trzecich (jsQR, `pg`, PostgreSQL). Treść nie była konsultowana
z prawnikiem — zalecana weryfikacja przed podpisaniem umowy.

## 8. Czego nie sprawdzono

* Prawdziwy Windows (testy instalatora pod Wine) i prawdziwa baza produkcyjna (brak dostępu).
* PostgreSQL na innym komputerze i połączenie TLS — konfiguracja jest, test nie był wykonany.
* `npm run test:server` na PostgreSQL (wiele serwerów równolegle wymagałoby osobnych baz); zakres pokrywają `server-pg` i e2e na PostgreSQL.
* Instalacja cicha (`/VERYSILENT`) nie wykonuje kroku „Baza danych” — serwer zostaje na dotychczasowej bazie.
* Awaria zasilania serwera bazy (testowane było zrywanie połączeń).

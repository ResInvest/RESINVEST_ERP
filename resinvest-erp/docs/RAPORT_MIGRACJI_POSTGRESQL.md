# Raport: migracja ResInvest ERP Serwer z SQLite na PostgreSQL

Data: 2026-11-10 · wersja programu: 3.14.0 (silnik i interfejs bez zmian) · gałąź: `ccr-ed20f738-ngabkd`

## 1. Podsumowanie

| Obszar | Stan |
|---|---|
| Warstwa PostgreSQL w serwerze (tryb firmowy) | wykonana, przetestowana na PostgreSQL 16.15 |
| SQLite (tryb jednostanowiskowy / awaryjny / powrót) | zachowany, zachowanie bez zmian |
| Narzędzie migracji, kontroli i wycofania | wykonane, przetestowane na danych testowych |
| Testy PostgreSQL (nowe) | 47 / 47, pięć pełnych przebiegów bez błędu |
| Dotychczasowe testy programu na zmienionym kodzie | jednostkowe 203 / 203, serwerowe 80 / 80, przeglądarkowe 459 / 459 |
| Testy przeglądarka + serwer na PostgreSQL | 66 / 66 (`e2e-server`, `e2e313`, `e2e314`) |
| **Migracja bazy produkcyjnej** | **NIE wykonana — wymaga Twojej zgody i dostępu do serwera firmy** |
| Instalator Windows (`installer/ResInvestERP.iss`) | uzupełniony o warstwę bazy, narzędzie migracji i sterownik; **nieskompilowany** (brak Wine / Windows w środowisku pracy) |

## 2. Analiza stanu wyjściowego

Praca opiera się na źródłach 3.14.0 z gałęzi `ccr-7050ba98-yk1is9` (PR #2). Na początku odtworzyłem je z przesłanego
instalatora `ResInvestERP_SerwerFirma.exe` (rozpakowany statycznie, bez uruchamiania); pliki serwera okazały się
bajt w bajt identyczne ze źródłami z PR #2, więc zmiany zostały połączone z tą gałęzią — razem z jej testami,
narzędziami i skryptami instalatorów.

Ustalenia:

* cała trwałość jest w klasie `Store` (`server/core.mjs`): synchroniczny `node:sqlite`, 8 tabel, stan programu w pamięci
  serwera, każda komenda = jedna transakcja (zmienione rekordy + rdzeń stanu + wpis dziennika z łańcuchem SHA-256),
* poza `Store` z bazy korzystają bezpośrednio tylko dwa miejsca w `riw-server.mjs` (odblokowanie konta, dziennik logowań),
* tryb OFFLINE (plik HTML bez serwera) nie używa SQLite — dane trzyma przeglądarka; nie wymagał zmian.

## 3. Rozwiązanie

Zasada: nie zmieniać silnika, logiki, API ani interfejsu — wymienić wyłącznie sterownik pod `Store`.

* `server/db/` — wspólny interfejs dla obu silników; PostgreSQL przez sterownik `pg` w wątku roboczym z synchronicznym
  wywołaniem (kolejność poleceń i transakcji identyczna jak w SQLite). Opis: `docs/POSTGRESQL.md`.
* Zakres zmian w istniejącym kodzie: `core.mjs` i `riw-server.mjs` — po kilkadziesiąt wierszy (wybór silnika, zapis stanu,
  kopia, przywracanie, blokada serwera); `mail.mjs`, silnik (`engine.js`, `service.js`) i moduły interfejsu — **bez zmian**.
  Poza tym: jeden nowy komunikat w słowniku `i18n.d27.js` (CS/EN), skrypty budowy instalatora, `tools/loadtest.mjs`
  (odczyt rozmiaru pliku bazy w trybie PostgreSQL), przebudowane pliki `ResInvest_ERP*.html` (nowy komunikat w słowniku).
* Jedyna nowa zależność: `pg` (czysty JavaScript) — **pierwsza zależność npm w projekcie**. Tryb SQLite jej nie ładuje
  i działa bez `node_modules`; instalator dołącza ją po `npm ci --omit=dev`. To decyzja do Twojej akceptacji —
  alternatywą jest własna implementacja protokołu PostgreSQL (więcej kodu do utrzymania, mniej sprawdzona).
* Jedyna zmiana widoczna w API: dodatkowe pole `db` w `/api/health` oraz nowy kod błędu `DB_UNCERTAIN` (tylko PostgreSQL,
  tylko przy zerwaniu połączenia w chwili zatwierdzania zapisu).

Dodane zabezpieczenia trybu PostgreSQL: blokada „jeden serwer zapisujący”, kontrola rewizji przy każdym zapisie,
rozstrzyganie zapisów o nieznanym wyniku na podstawie dziennika, ponowne wczytanie stanu z bazy po niepewnym zapisie.

## 4. Testy

Środowisko: Linux, Node.js 22.23, PostgreSQL 16.15 (lokalny klaster testowy), konto bazy bez uprawnień administratora.
Uruchomienie: `npm run test:pg` z `RIW_TEST_PG_URL`.

| Zestaw | Plik | Testy | Co sprawdza |
|---|---|---|---|
| Jednostkowe warstwy bazy | `tests/db-dialect.test.mjs` | 9 | tłumaczenie SQL, zgodność interfejsu z `node:sqlite`, typy (REAL, BIGINT), transakcje, dziennik tylko do dopisywania, konfiguracja |
| Regresja silników | `tests/regression-engines.test.mjs` | 8 | ten sam scenariusz (37 komend) na SQLite i PostgreSQL: wyniki komend, stan, tabele `state`/`rows`/`journal`, stany magazynowe — **identyczne bajt w bajt** |
| Migracja | `tests/migration.test.mjs` | 9 | plan, migracja, zgodność tabel, nienaruszony plik źródłowy, odmowy, atomowość, wycofanie, przywracanie, starsza baza |
| Integracja HTTP + bezpieczeństwo | `tests/server-pg.test.mjs` | 13 | API na PostgreSQL, dwóch użytkowników, kopie, druga instancja serwera, zerwane połączenie, konflikt rewizji, 401/403, role, wstrzyknięcie SQL, blokada konta, wykrycie ingerencji, restart |
| Ochrona przed utratą danych | `tests/resilience-pg.test.mjs` | 6 | zerwanie połączenia przed i w chwili zatwierdzania, baza niedostępna, niepewny wynik zapisu |
| Obciążenie | `tests/load-pg.test.mjs` | 2 | równoczesne zapisy i odczyty wielu użytkowników na obu silnikach |

### Dotychczasowe testy programu

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n` (CS/EN: 0 braków, 0 nieużywanych), `npm run themes`, `npm run build` | zaliczone |
| `npm run test:unit` | 203 / 203 |
| `npm run test:server` (SQLite) | 80 / 80 |
| `npm run test:e2e` (Chromium; SQLite) | 382 + 32 + 11 + 21 + 13 = 459 / 459 |
| `e2e-server`, `e2e313`, `e2e314` z serwerem na **PostgreSQL** (`DB_DRIVER=postgres`) | 32 + 21 + 13 = 66 / 66 |
| `tools/loadtest.mjs --users 40 --seconds 20` na SQLite | zaliczony: 3 786 żądań, 186,6/s, 0 błędów |
| `tools/loadtest.mjs --users 40 --seconds 20` na **PostgreSQL** | zaliczony: 3 574 żądania, 176,5/s, 0 błędów, 1 178 operacji bez strat i duplikatów, skany 205 / 205, `--check` OK |

Testów `npm run test:server` nie uruchamiałem na PostgreSQL: startują wiele serwerów równolegle, a każdy wymagałby
osobnej bazy. Ich zakres na PostgreSQL pokrywają częściowo testy `tests/server-pg.test.mjs` i testy przeglądarkowe powyżej.

Scenariusz regresyjny (nowe testy) obejmuje: zakup z produkcją i transportem własnym, zakup towaru, sprzedaż (WZ), odmowę sprzedaży
ponad stan, produkcję, przesunięcie MM dwuetapowe (odmowa obcego magazynu, przyjęcie z różnicą, odmowa drugiego
przyjęcia), korektę i jej wycofanie, anulowanie, wersje robocze, kartoteki, użytkowników, ustawienia, planer,
powiadomienia, rejestr wydruków, inwentaryzację miesiąca z zamknięciem, odmowy uprawnień, walidację.

### Kontrola danych przed i po migracji (baza testowa)

Każda tabela: liczba wierszy i SHA-256 treści — zgodne 9 / 9; rewizja, SHA-256 pełnego stanu, czoło łańcucha dziennika,
liczba kont — identyczne; SHA-256 pliku źródłowego przed i po — identyczne; identyfikatory i liczniki numeracji zachowane
(także luka w numeracji kolejki poczty). Większa baza testowa (27 MB, 12 110 rekordów, 3 001 wpisów dziennika):
import z kontrolą w 2,5 s, różnic 0.

### Obciążenie (jeden komputer, baza lokalna)

| Pomiar | SQLite | PostgreSQL |
|---|---|---|
| 24 użytkowników × 12 zapisów równocześnie (HTTP) — zapisów/s | 80–117 | 58–62 |
| — mediana / p95 czasu zapisu | 75–108 ms / 135–191 ms | 125–136 ms / 302–348 ms |
| 60 użytkowników × 20 zapisów (1 200 zapisów) — zapisów/s | 83 | 64 |
| — mediana / p95 czasu zapisu | 220 ms / 454 ms | 275 ms / 660 ms |
| Pojedynczy zapis komendy w serwerze (500 operacji) | 2,5 ms | 5,2 ms |
| Kopia zapasowa (2 110 rekordów) | 23 ms | 131 ms |
| Start serwera (wczytanie stanu) | 106 ms | 236 ms |

We wszystkich przebiegach: 0 błędów, 0 utraconych zapisów, numeracja dokumentów ciągła i niepowtarzalna, stan magazynu
równy sumie przyjęć, kontrola spójności po obciążeniu poprawna. PostgreSQL jest na jednym komputerze wolniejszy od
SQLite (połączenie sieciowe zamiast pliku), z dużym zapasem względem potrzeb firmy. Przy 3 000 operacji na SQLite czas
pojedynczego zapisu rósł z 2,2 do 6,9 ms — to koszt silnika aplikacji przy dłuższej historii, istniejący przed migracją;
na PostgreSQL przy 500 operacjach wzrostu nie było, dłuższej serii na PostgreSQL nie mierzyłem.

## 5. Błędy wykryte i naprawione w trakcie prac

| # | Błąd | Wykryty przez | Poprawka | Ponowny test |
|---|---|---|---|---|
| 1 | Tłumacz SQL traktował `AS IDENTITY` w definicji tabeli jak alias kolumny — import do PostgreSQL kończył się błędem składni | testy migracji | aliasy rozpoznawane tylko w zapisie camelCase | migracja 9/9, dodany test jednostkowy |
| 2 | Login zawierający znak NUL: na PostgreSQL błąd 500 zamiast odmowy 401 (PostgreSQL nie przyjmuje NUL w tekście) | test wstrzyknięć | tekst obcinany na znaku NUL — tak samo, jak czyta go program z SQLite | serwer 13/13, test jednostkowy |
| 3 | Zegar testowy: warstwa PostgreSQL używała `Date.now()` do limitów czasu | test regresji | zegar monotoniczny (`performance.now()`), odporny na zmianę czasu systemowego | regresja 8/8 |
| 4 | Utracone potwierdzenie zapisu + baza niedostępna: serwer zgłaszał „nic nie zapisano”, choć zapis mógł się dokonać — stan w pamięci rozjeżdżał się z bazą (wystąpiło raz w równoległym przebiegu) | test odporności | wynik rozstrzygany w dzienniku; gdy to niemożliwe — komunikat „sprawdź zapis” i wczytanie stanu z bazy przed następną operacją; stare połączenie zamykane bez czekania | odporność 6/6, pełny zestaw 4× |
| 6 | `tools/loadtest.mjs` kończył się błędem w trybie PostgreSQL (odczyt rozmiaru nieistniejącego pliku `resinvest.sqlite`) | test obciążeniowy projektu na PostgreSQL | rozmiar 0, gdy pliku nie ma | loadtest na obu silnikach: zaliczony |
| 5 | Wartości tekstowe ze znakiem NUL w SQLite są widziane przez program tylko do tego znaku | test migracji | raport migracji podaje liczbę takich wartości; przenoszona jest część widoczna dla programu | migracja 9/9 |

## 6. Czego nie zweryfikowałem

* **Baza produkcyjna** — nie mam do niej dostępu; wszystkie wyniki dotyczą danych przykładowych programu i danych
  wytworzonych w testach. Polecenie `plan` pokaże stan rzeczywistej bazy bez jej zmieniania.
* **Windows i instalatory** — testy przeszły na Linuksie; instalatorów nie zbudowałem (brak Wine w środowisku pracy),
  więc zmiana w `installer/ResInvestERP.iss` (trzy wiersze `Source:`) i w skryptach budowy nie była kompilowana.
* **Testy `npm run test:server` na PostgreSQL** — patrz rozdz. 4.
* **Połączenie szyfrowane (TLS) z PostgreSQL** i baza na innym komputerze — konfiguracja jest, test nie był wykonany.
* **Przerwanie pracy przez wyłączenie zasilania** serwera bazy — testowane było zrywanie połączeń, nie awaria sprzętu.
* **Paczka testów Windows** (`installer/test-windows`) nie zawiera nowych testów PostgreSQL — wymagają działającego PostgreSQL.

## 7. Gotowość do wdrożenia

Kod jest gotowy do próby na serwerze firmy. Zalecana kolejność (szczegóły: `docs/POSTGRESQL.md`, rozdz. 2–3):

1. Zbudować instalatory (`installer/build-installer.ps1` albo `build-installer-wine.sh`) i zainstalować jako aktualizację
   (dane i tryb SQLite pozostają bez zmian).
2. Uruchomić serwer na SQLite — potwierdzić, że nic się nie zmieniło.
3. Zainstalować PostgreSQL, założyć konto i bazę, wpisać dane do `server.env`.
4. `ResInvestERP-Migracja.cmd plan` — ocenić wynik (niczego nie zmienia).
5. **Po Twojej zgodzie:** `migrate --confirm`, przegląd raportu, `DB_DRIVER=postgres`, start, kontrola spójności.
6. Przez pierwsze dni zachować plik `resinvest.sqlite` i codziennie sprawdzać kopie.

Powrót do SQLite jest możliwy w każdej chwili (rozdz. 5 instrukcji) — bez utraty danych wprowadzonych w PostgreSQL.

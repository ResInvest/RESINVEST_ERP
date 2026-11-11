# ResInvest ERP 3.15 — architektura

Dokument opisuje warstwy programu, zasady zależności między nimi, strukturę folderów, przepływ jednej operacji
oraz plan dalszego porządkowania. Zasada nadrzędna: **zachowanie programu się nie zmienia** — porządkowanie
dotyczy wyłącznie struktury kodu i każdorazowo jest sprawdzane pełnym zestawem testów.

## 1. Warstwy (od środka na zewnątrz)

```
            ┌─────────────────────────────────────────────────────────────┐
            │ PREZENTACJA (przeglądarka)                                  │
            │ app/src/core.js · views.js · form.js · admin.js · …-view.js │
            │                ↓ Store.exec("komenda", args)                 │
            ├─────────────────────────────────────────────────────────────┤
            │ APLIKACJA (przypadki użycia)                                │
            │ app/src/service.js — komenda → uprawnienie → funkcja silnika│
            │ server/core.mjs (Store) — transakcja, dziennik, kopie        │
            │ server/http/state-view.mjs — widok stanu dla użytkownika     │
            ├─────────────────────────────────────────────────────────────┤
            │ DOMENA (silnik — czysty JavaScript, bez I/O)                │
            │ app/src/engine.js · planner.js · trade.js · fleetrep.js ·    │
            │ notify.js · opening.js · yardplan.js                         │
            ├─────────────────────────────────────────────────────────────┤
            │ INFRASTRUKTURA                                              │
            │ server/db/* (SQLite | PostgreSQL) · server/mail.mjs ·        │
            │ server/env-file.mjs · server/http/respond.mjs · rate-limit · │
            │ przeglądarka: localStorage, IndexedDB (skany)                │
            └─────────────────────────────────────────────────────────────┘
```

**Reguła zależności:** warstwa zewnętrzna może używać wewnętrznej, nigdy odwrotnie.
* Silnik nie wie, czy działa w przeglądarce czy w serwerze, ani gdzie są zapisywane dane: dostaje stan i kontekst
  (`ctx.user`, `ctx.today`), zwraca wynik i nowy stan. Dlatego ten sam plik działa w trybie lokalnym i na serwerze,
  a reguły magazynowe istnieją w jednym miejscu.
* Warstwa aplikacji nie zna HTTP (`Store`, `Service`, `state-view`) — HTTP i CLI tylko ją wywołują.
* Infrastruktura jest wymienialna za interfejsem: `server/db/sqlite.mjs` i `server/db/postgres.mjs` mają ten sam
  interfejs (`exec / prepare → get / all / run / iterate`), więc przejście na PostgreSQL nie zmieniło `Store` ani silnika.

## 2. Struktura folderów

```
resinvest-erp/
├── app/
│   ├── src/                      kod programu (ten sam w przeglądarce i w serwerze)
│   │   ├── engine.js             DOMENA: stan (SCHEMA), migracje, operacje, księga, stany, korekty, uprawnienia
│   │   ├── planner.js · trade.js · fleetrep.js · notify.js · opening.js   DOMENA: moduły silnika
│   │   ├── service.js            APLIKACJA: komendy → uprawnienie → silnik (jedno wejście dla UI i serwera)
│   │   ├── seed.js               dane przykładowe i czysta baza
│   │   ├── i18n.js · i18n.dNN.js tłumaczenia (PL → CS / EN)
│   │   ├── auth.js · pdf.js · office.js       usługi przeglądarki (hasła lokalne, PDF, XLSX/DOCX)
│   │   └── core.js · views.js · form.js · quick.js · dashboard.js · admin.js · scans.js ·
│   │       planner-view.js · notify-view.js · opening-view.js · intro.js     PREZENTACJA
│   ├── assets/ · vendor/         czcionki, ikony, film, jsQR
├── server/
│   ├── riw-server.mjs            punkt startowy: konfiguracja, polecenia CLI, trasy /api/*, start i zatrzymanie
│   ├── core.mjs                  APLIKACJA: Store — wykonanie komendy w transakcji, dziennik SHA-256, konta, sesje, kopie, skany
│   ├── http/                     PREZENTACJA SERWERA (HTTP)
│   │   ├── respond.mjs           odpowiedzi, nagłówki bezpieczeństwa, gzip, odczyt treści żądania
│   │   ├── state-view.mjs        widok stanu użytkownika (izolacja magazynów), synchronizacja zmianami
│   │   └── rate-limit.mjs        okno przesuwne: próby logowania, wysyłka e-mail
│   ├── db/                       INFRASTRUKTURA: bazy danych
│   │   ├── index.mjs             wybór silnika (DB_DRIVER), konfiguracja połączenia
│   │   ├── schema.mjs            jeden opis schematu dla SQLite i PostgreSQL
│   │   ├── sqlite.mjs · postgres.mjs · pg-worker.mjs
│   │   └── transfer.mjs          przenoszenie danych, odciski tabel
│   ├── migrate.mjs · db-setup.mjs   migracja SQLite → PostgreSQL, przywracanie, instalator „Baza danych”
│   ├── mail.mjs                  INFRASTRUKTURA: SMTP / Resend / AgentMail / plik
│   └── env-file.mjs              INFRASTRUKTURA: zapis server.env
├── tools/                        budowa (build.mjs), tłumaczenia, kontrast motywów, migracja, testy obciążeniowe
├── installer/                    Inno Setup: ResInvestERP.iss, warianty (editions/), skrypty .cmd, test Windows
├── tests/                        node:test (silnik, serwer, PostgreSQL) i Playwright (e2e)
├── config/ · data/ · docs/
└── ResInvest_ERP.html · ResInvest_ERP_Demo.html · ResInvest_ERP_Premium.html   zbudowane programy
```

## 3. Przepływ jednej operacji (np. sprzedaż WZ)

1. **Formularz** (`form.js`) buduje szkic i wywołuje `Store.exec("op.commit", { draft })`.
2. **Tryb lokalny:** `LocalBackend` → `Service.run` → silnik → nowy stan → `localStorage`.
   **Tryb serwera:** `POST /api/cmd` → `riw-server.mjs` (sesja, CSRF) → `Store.execute`.
3. **Service** (`service.js`) sprawdza uprawnienie komendy i wywołuje `R.commitOperation` na kopii roboczej stanu.
4. **Silnik** (`engine.js`) waliduje, planuje dokumenty (numer WZ), księguje ruchy, dopisuje audyt i powiadomienia.
5. **Store** (`core.mjs`) zapisuje tylko zmienione rekordy + wpis dziennika w **jednej transakcji** (SQLite lub PostgreSQL),
   dopiero potem podmienia stan w pamięci.
6. **Widok** (`http/state-view.mjs`) liczy zmiany od rewizji przeglądarki; SSE powiadamia pozostałe stanowiska.

## 4. Gdzie dodawać nowe funkcje

| Rodzaj zmiany | Miejsce |
|---|---|
| Nowa reguła biznesowa / dokument | moduł domeny w `app/src/<nazwa>.js` (wzór: `opening.js`, `planner.js`), eksport na `R` |
| Nowa czynność użytkownika | komenda w `service.js` z uprawnieniem z `R.PERMS` |
| Nowy ekran | `app/src/<nazwa>-view.js` (wzór: `opening-view.js`), wpis w `NAV` (`core.js`) i w `SCRIPTS` (`tools/build.mjs`) |
| Nowe teksty | najnowszy słownik `i18n.dNN.js` (CS i EN), `npm run i18n` = 0 braków |
| Zmiana zapisu danych | wyłącznie `server/db/*` + `schema.mjs` (oba silniki), testy `npm run test:pg` |
| Nowe API HTTP | trasa w `riw-server.mjs` → wywołanie `Store` / `Service` (bez logiki biznesowej w trasie) |

## 5. Zmiany struktury w 3.15 (zachowanie bez zmian)

| Zmiana | Efekt |
|---|---|
| `server/db/*` — warstwa bazy za wspólnym interfejsem | PostgreSQL bez zmian w `Store` i w silniku |
| `server/http/respond.mjs`, `state-view.mjs`, `rate-limit.mjs` wydzielone z `riw-server.mjs` | HTTP oddzielone od widoku stanu; `riw-server.mjs` 968 → 843 wiersze |
| `server/env-file.mjs` — jeden zapis `server.env` | usunięta kopia kodu (poczta z programu i instalator) |
| jeden ogranicznik zamiast dwóch + okresowe czyszczenie | pamięć nie rośnie z liczbą adresów IP |
| `opening.js` / `opening-view.js` — nowa funkcja jako osobny moduł domeny i osobny ekran | brak zmian w `engine.js` poza eksportem modułu |
| `yardplan.js` / `yardplan-view.js` — plan placu, terminarz pociągów, symulacja i realizacja załadunku jako osobny moduł domeny i osobne ekrany; kolekcje `yard`, `trains`, `loadPlans` w `ROWS` | silnik magazynowy bez zmian: stan zmienia tylko `commitOperation` (WZ) wywołane przy zakończeniu załadunku |
| optymalizacje: szybka ścieżka zapisu (`core.mjs`), indeks sum stanów i raporty (`engine.js`), jedno odświeżenie na klatkę (`core.js`) | wyniki identyczne bajt w bajt — [WYDAJNOSC.md](WYDAJNOSC.md) |

Weryfikacja każdej zmiany: `npm run check`, `npm run i18n`, testy jednostkowe (216), serwerowe (85), e2e,
PostgreSQL, test obciążeniowy projektu.

### Recenzja zmian 3.15 (wynik i poprawki)

| Uwaga recenzenta | Poprawka | Test |
|---|---|---|
| Numer BO z edytora mógł powtórzyć numer WZ wpisany wcześniej ręcznie (ta sama seria, magazyn i rok) | `opening.js`: licznik serii przesuwany za numery zajęte (`docNoTaken`), jak w formularzu operacji | `features315`: „omija numer WZ wpisany wcześniej ręcznie” (bez poprawki: duplikat `WZ/002/11/2026`) |
| Wersja demonstracyjna dzieliła z programem firmowym preferencje przeglądarki (motyw, język, intro, adresy e-mail) | `lsKey` w `core.js`, klucze w `intro.js` i `views.js`, skrypt motywu przed pierwszym malowaniem w `build.mjs` | `e2e315demo` (izolacja kluczy) |
| Dokument BO zmniejszający stan (korekta stanu początkowego) oznaczony „+” w rejestrze | znak „±” dla BO z ujemną pozycją | — |
| Testy 3.15 poza budową instalatora i paczką testów Windows | dopisane do `build-installer*.{sh,ps1}` i `make-test-pack.py` | — |
| Czyszczenie ogranicznika stałym oknem 60 min | czyszczenie wg najdłuższego faktycznie użytego okna | `server-modules315` |
| Braki testów | nieaktywny produkt i magazyn, rola z ograniczonym dostępem, numeracja „osobne serie”, `env-file`, `rate-limit` | `features315`, `server-modules315` |

Znane ograniczenia sprzed 3.15 (bez zmian, do osobnej decyzji): numery KOR/AN korzystają z tego samego licznika
bez pomijania numerów zajętych; `Dates.isISO` przyjmuje nieistniejące daty (np. 2026-02-30).

## 6. Dalsze porządkowanie (plan, kolejność wg ryzyka)

1. **Trasy API** — `handleApi` (ok. 380 wierszy w `riw-server.mjs`) podzielić na `server/http/routes/{auth,users,mail,scans,backups,state}.mjs`
   z jawnie przekazywanymi zależnościami (`store`, `cfg`, `mail`). Pokrycie testami: serwer 80 + e2e serwera.
2. **Polecenia CLI** — `--restore`, `--check`, `--backup-now`, `--reset-password`, `--mail-*`, `--db-setup` do `server/cli.mjs`.
3. **Silnik** — `engine.js` (3 346 wierszy) dzielić na moduły domeny tak jak `planner.js` (`stock.js`, `documents.js`,
   `inventory.js`, `masterdata.js`, `roles.js`), zachowując jeden obiekt `R` i kolejność ładowania w `SCRIPTS`.
   Warunek: testy jednostkowe silnika + test regresji silników (stan i dziennik identyczne bajt w bajt) przed i po.
4. **Ekrany** — `views.js` i `form.js` dzielić wg modułów menu (operacje, dokumenty, raporty), jak `planner-view.js`.

Każdy krok osobno, z pełnym zestawem testów; bez zmiany zachowania i bez zmian w danych.


## 3.16: moduł EUDR

Silnik `app/src/eudr.js` (+ treści `eudr-content.js`) w tym samym wzorcu co pozostałe warstwy: komendy `eudr.*` w `service.js`, uprawnienia według ról EUDR (sprawdza silnik), 7 kolekcji wierszy w bazie serwera. Serwer: `server/eudr-routes.mjs` (pliki, Centrum testów, złożenie i status DDS) i `server/eudr-traces.mjs` (klient SOAP V4, WS-Security; dane dostępowe wyłącznie z `server.env`). Ekrany: `app/src/eudr-view.js`. Opis: `docs/EUDR.md`.

# ResInvest ERP — plan zmian (FAZA 0 → FAZA 1)

Dokument powstał **przed** napisaniem kodu, na podstawie analizy dostarczonego pliku
`ResInvestERP_1.3.0.html` i wymagań ResInvest Commodities.

## 1. Punkt wyjścia

| Element | Stan |
|---|---|
| Repozytorium projektu | katalog `resinvest-erp/` (kod programu, serwer, testy, instalator, dokumentacja) |
| Źródło prawdy o poprzednim systemie | plik `ResInvestERP_1.3.0.html` (7650 linii, 2,57 MB, w tym film intro jako data URI) |
| Narzędzia testowe | Node.js 22, Playwright + Chromium, ESLint, Prettier |

Wniosek: FAZA 1 powstaje jako nowy projekt `resinvest-erp/`, bez zależności od zewnętrznych
frameworków; FAZA 2 rozbudowuje go o logowanie i serwer wielostanowiskowy (patrz §7 i „FAZA 2”).

## 2. Architektura ResInvestERP 1.3.0 (odczytana z kodu, nie z nazw)

Plik jest aplikacją jednoplikową złożoną z warstw (`<script>` / `<style>`):

| Warstwa | Linie | Zawartość |
|---|---|---|
| 1–2 | 9–925 | Design system: tokeny (motywy Perła / Grafit / Graphite Azure), komponenty CSS, `.splash*` |
| 3 | 925–1100 | Rdzeń `U` — m.in. **`U.num()`** (parser liczb), `U.round`, ikony, magistrala `Bus` |
| 4 | 1101–1776 | I18N PL/CS/EN, formatowanie `F.n / F.money` (Intl `pl-PL`) |
| 5 | 1777–2136 | `Store` — IndexedDB + awaryjny localStorage; `DEFAULT_SETTINGS.conv = {mp_t:0.33, t_gj:8.5, m3_mp:4}`; `SEED` |
| 6 | 2137–2628 | Domena: `Units` (MP jako jednostka bazowa), `Cert` (DEKL/KZR), `Money`, `OP_META`, `docTypeFor`, `Ledger`, `Stock`, `Num` (numeracja `{TYP}/{NR}/{MM}/{RRRR}`), `PERMS`, `Auth`, `Audit`, `Validate` (w tym `Validate.batch` — symulacja stanów łańcucha), `Reports` |
| 7–8 | 2670–3558 | Komponenty UI, powłoka, router, logowanie |
| 9 | 3559–4033 | Pulpit |
| 10 | 4034–5356 | **`OpForm`** — formularz operacji, łańcuch ZAKUP → RW → PW → WZ / WYWÓZ, transport, pociąg, korekty (storno + nowy dokument) |
| 11 | 5357–5819 | Magazyny, stany, kartoteki, dokumenty |
| 13–15 | 5820–6883 | Excel (.xlsx), praca wielostanowiskowa (PostgreSQL/Supabase), serwer |
| 16–17 | 6884–7043 | `INTRO_SRC` (mp4 H.264 + **AAC** — film ma ścieżkę dźwiękową), `Splash` |
| 12 | 7044–7650 | Raporty, administracja, kopie, start |

### Gdzie jest obecna logika objęta zmianą

* **Nowa operacja** — `OpForm.open()` (l. 4138). Łańcuch: `chainState` + `CH.plan()` (l. 4182–4237), zapis `buildChain()` (l. 4897) i `save()` (l. 4983).
* **Magazyn/pryzma źródłowa i docelowa** — l. 4483–4490 (`whId`, `pileId`, `whToId`, `pileToId`); plan dokumentów pokazuje „→ Magazyn docelowy” (l. 4233).
* **Transport** — `transportKind` ∈ `truck | train | own | none` (l. 4510), `effTransport()` (l. 4267), „transport w cenie” (l. 4568).
* **Pociąg** — `wagons`, `wagonMP` (domyślnie 120 MP), `trainNo`, przycisk „wagony → ilość” (l. 4518–4537).
* **Jednostki** — `Units.toMP / fromMP / derive` (l. 2144); waga ręczna `tonsMode/tonsManual` nie zmienia MP (l. 4256).
* **Liczby** — `U.num()` (l. 937): usuwa białe znaki (w tym NBSP) i zamienia **pierwszy** przecinek na kropkę.
* **Intro/audio** — `Splash.play()` (l. 6914): film startuje **wyciszony**, dźwięk włącza kliknięcie; kliknięcie w tło **pomija** intro.
* **Inwentaryzacja** — istnieje tylko typ operacji `INWENT` (dokument IN). **Brak** miesięcznych okresów i blokady.
* **Flota** — **brak**. Pojazd i kierowca to wolny tekst uczony z historii (`Learn.values("vehicle"/"driver")`), przewoźnicy w kartotece `carriers`.
* **Audyt** — `Audit.log(action, entity, entityId, detail)` — zapisuje tekst, **bez stanu przed/po** i bez źródła; przycina log do 4000 wpisów.

### Błędy / ryzyka znalezione w obecnym kodzie

1. `U.num("1.250,50")` → `parseFloat("1.250.50")` = **1,25** (błąd o trzy rzędy wielkości).
2. `U.num("1,250.50")` → **1,25**.
3. Pola ilości/ceny to `<input type="number">` — Chrome/Edge w polskim systemie odrzucają wklejone `1 250,50`, a wartość z przecinkiem potrafi dojść jako pusty string → **cicha zamiana na 0**.
4. W łańcuchu bez sprzedaży powstaje `WYWOZ` (MM) z magazynu źródłowego do docelowego — przy tym samym magazynie formularz blokuje zapis, ale przy różnych magazynach transport **przenosi stan** między lokalizacjami (to zgodne z modelem MM, ale sprzeczne z nową zasadą, że transport nie zmienia stanu i magazyn wynika z kontekstu użytkownika).
5. Audyt nie pozwala odtworzyć stanu przed zmianą.
6. Autoplay: film zawsze startuje wyciszony — wymaganie „muzyka domyślnie WŁĄCZONA” nie jest spełnione.

## 3. Decyzje projektowe FAZY 1

| Wymaganie | Decyzja |
|---|---|
| Jednostka bazowa | **MP** (zgodnie z istniejącym `Units`). Drewno prezentowane w m³ (MP/4), zrębka w MP, tony zawsze wyliczane (MP × 0,33) albo wpisane jako waga rzeczywista — waga **nie** zmienia ilości ewidencyjnej. |
| Magazyn | Wynika z użytkownika (`user.whId`). Z formularza usunięto magazyn/pryzmę źródłową i docelową. |
| Operacja | Agregat: zakup → zużycie → produkcja → sprzedaż + transport. Księgi (ledger) tworzone w stałej kolejności, walidowane symulacją sald od bieżącego stanu, zapisywane atomowo (całość albo nic). |
| Transport | Brak zapisów w księdze — tylko koszt i dokument TR z „Miejsce transportu”. Tryby: własny / zewnętrzny / pociąg (wzajemnie wykluczające się pola wyboru). |
| Pociąg | Zachowany model (liczba wagonów, pojemność wagonu w MP, nr składu) + tony per wagon lub „ta sama tonaż dla wszystkich” + cena za MP / m³ / t. |
| Liczby | Nowy parser `NumParse` (ostatni separator = dziesiętny, grupy tysięcy walidowane, NBSP/wąska spacja, jednostki `m³/MP/t/zł/km`). Pola tekstowe `inputmode="decimal"`. |
| Dokumenty | PZ, RW, PW, WZ, TR (+ KO storno, IN inwentaryzacja, BO bilans otwarcia). Kolumna **„Miejsce transportu”** zamiast „Magazyn docelowy”. |
| Inwentaryzacja | Okres `RRRR-MM` per magazyn, `OTWARTA → ZAMKNIĘTA`. Zamknięcie księguje różnice dokumentem IN i blokuje operacje z datą ≤ zamkniętego miesiąca. Automatyczne zamknięcie poprzednich miesięcy przy pierwszym uruchomieniu w nowym miesiącu. |
| Flota | Pojazdy (nazwa, rejestracja, typ, status, kierowca domyślny), kierowcy, rębaki (nazwa, status, operator domyślny), operatorzy. Kurs zapisuje **kopię** kierowcy (id + nazwisko). |
| Wieloużytkowość (demo) | Przełącznik użytkownika, role z uprawnieniami sprawdzanymi w silniku, blokada Web Locks między kartami, ponowna walidacja na świeżym stanie, klucz idempotencji formularza, zdarzenie `storage` odświeża inne karty. |
| Audyt | `użytkownik, czas, operacja, akcja, stan przed, stan po, źródło`. |
| Intro | Ten sam film (z dźwiękiem) wbudowany w plik. Próba odtworzenia z dźwiękiem → przy blokadzie autoplay odtwarzanie wyciszone + pierwszy gest włącza muzykę. Brak kodeka → plansza + muzyka syntezowana Web Audio. |

## 4. Pliki

| Plik | Rola |
|---|---|
| `resinvest-erp/demo/src/engine.js` | Czysta logika domenowa (bez DOM) — testowalna w Node |
| `resinvest-erp/demo/src/seed.js` | Dane przykładowe, księgowane przez silnik |
| `resinvest-erp/demo/src/app.js` | Interfejs (moduły ekranów) |
| `resinvest-erp/demo/src/intro.js` | Intro + muzyka |
| `resinvest-erp/demo/src/styles.css` | Styl (tokeny ResInvest — ciemny grafit, zielony akcent) |
| `resinvest-erp/demo/src/index.template.html` | Szablon |
| `resinvest-erp/demo/assets/intro.mp4` | Film intro wyodrębniony z 1.3.0 |
| `resinvest-erp/tools/build-demo.mjs` | Składa jeden plik `ResInvest_ERP_demo.html` |
| `resinvest-erp/ResInvest_ERP_demo.html` | **Demonstrator** (wynik budowania) |
| `resinvest-erp/tests/engine.test.mjs` | Testy jednostkowe silnika (Node `node:test`) |
| `resinvest-erp/tests/e2e.cjs` | Scenariusze A–G w przeglądarce (Playwright) |
| `resinvest-erp/tests/resinvest_demo_scenarios.md` | Scenariusze manualne |
| `resinvest-erp/docs/RESINVEST_UI_SUGGESTIONS.md` | Usprawnienia poza zakresem |
| `resinvest-erp/progress.md` | Stan prac |

Plik `ResInvestERP_1.3.0.html` **nie jest modyfikowany**.

## 5. Testy

* Jednostkowe: parser liczb (12,50 / 12.50 / 1 250,50 / 1 250,50 / 1.250,50 / błędne formaty), przeliczniki, scenariusze A–F na silniku, blokady (sprzedaż > produkcja, zużycie > dostępne), transport bez wpływu na stan, idempotencja, blokada zamkniętego okresu, storno, uprawnienia, wyścig dwóch zapisów.
* E2E (Chromium): scenariusze A–G przez UI, brak starych pól, kolumna „Miejsce transportu”, konsola bez wyjątków, dwie karty zapisujące ten sam stan, intro przy dozwolonym i zablokowanym autoplay, widok mobilny.

## 6. Ryzyka regresji (dla FAZY 2)

1. Usunięcie `WYWOZ/MM` z łańcucha — przemieszczenia między magazynami potrzebują osobnego, jawnego procesu (nie transportu w operacji zakupowej).
2. Zmiana parsera liczb zmienia interpretację `1.250` (teraz 1,25 — jak dotąd; jednoznaczne tylko `1.250,00`). Import Excela używa innej ścieżki — sprawdzić przed wdrożeniem.
3. Blokada zamkniętych okresów wpłynie na import historycznych danych i korekty wsteczne — korekty muszą iść dokumentem KO z bieżącą datą.
4. Dane z 1.3.0 z polami `whToId/pileToId` muszą zostać zmigrowane do `transport.place` (tekst) bez utraty informacji.
5. Kierowca zapisany jako tekst w starych dokumentach — migracja do słownika floty z zachowaniem kopii nazwiska.

## 7. FAZA 2 — najmniejsza zmiana architektoniczna

Specyfikacja zakłada produkcyjny React/NestJS/PostgreSQL. Taki kod nie istniał w projekcie,
a dostarczony 1.3.0 działa na IndexedDB z opcjonalną synchronizacją Supabase.
Przed FAZĄ 2 potrzebne jest jedno z dwóch:

* dołączenie repozytorium produkcyjnego (wtedy: `operations` jako agregat + `stock_ledger`
  append-only, transakcja `SERIALIZABLE` lub `SELECT … FOR UPDATE` na saldach
  `(warehouse_id, product_id)`, unikalny indeks na `idempotency_key`, tabela
  `inventory_periods` z CHECK na cykl życia, `fleet_vehicles / fleet_chippers /
  transport_runs(driver_id, driver_name_snapshot)`), albo
* decyzja, że FAZA 2 rozwija 1.3.0 (IndexedDB + Supabase) — wtedy silnik
  `engine.js` z demonstratora zastępuje `Validate.batch` / `buildChain`, a zapis
  idzie jedną transakcją IndexedDB `readwrite` na `operations + ledger + audit`.

---

# Demo v2 — zmiany modelu (uzupełnienie specyfikacji)

## Decyzje

| Wymaganie | Decyzja | Uzasadnienie |
|---|---|---|
| Stany w rzeczywistej jednostce; PKS/łupina tylko w t | **Księga prowadzona w jednostce magazynowej produktu** (`qty` + `unit`), nie w MP | Przy księdze w MP PKS musiałby być sztucznie przeliczany na MP — wprost zakazane w wymaganiu 4–5 |
| Jednostki produktu | `unit` ∈ m³ / MP / t; dozwolone jednostki wejścia: drewno m³·MP·t, zrębka MP·t, produkty tonowe tylko t | Brak przeliczenia = brak możliwości wyboru jednostki (formularz nie pokazuje opcji) |
| Masa orientacyjna | zrębka × 0,33 t/MP; drewno × **0,952 t/m³** (`config.woodTPerM3`) | Przykład z dodatku: 817 m³ ≈ 778 t → 0,952. **Uwaga:** w v1 masa drewna liczona była przez MP (1 m³ = 4 MP × 0,33 = 1,32 t) — dla 20 m³ dawało 26,4 t, teraz 19,04 t. Przelicznik 1 m³ = 4 MP zrębki pozostaje bez zmian. Jeśli firma chce wrócić do 1,32 t/m³, wystarczy zmienić `woodTPerM3` w `config/demo.config.json` |
| Niezależne operacje | `draft.type` ∈ ZAKUP / SPRZEDAZ (z magazynu albo `direct`) / PRODUKCJA | Wymaganie 10 i 12: każda ścieżka działa samodzielnie |
| Sprzedaż bezpośrednia | zapisy PW(+) i WZ(−) z flagą `direct` w tej samej operacji — saldo netto 0 | Pełna identyfikowalność (ile wyprodukowano, ile sprzedano) bez wzrostu stanu; niesprzedana reszta zostaje na stanie z ostrzeżeniem |
| Surowiec z lasu przy sprzedaży bezpośredniej | opcjonalny, **nie** zdejmowany ze stanu; ogranicza maks. wynik (m³ × 4) | „Nie pokazuj wymagania wcześniejszego zakupu ani pobrania z magazynu” |
| Powiązanie wejście → wyjście | PW ma `meta.fromDoc` = numer RW, operacja ma `production.rawProductId/outProductId` | Wymaganie 3 |
| Cena za rąbanie | `production.chipRate`, domyślnie `config.chipRateDefault` = 10 zł/MP; koszt w `totals.chippingCost`, na PW i w raportach | Wymaganie 9 |
| Pociąg | `capacity` + `capUnit` (t / MP), `tonMode` same / each (wzajemnie wykluczające się), `loadPlace`, `docNo`; podsumowanie składu liczone w silniku | Wymagania 6–8 |
| Dane v1 | nowy klucz `riw.demo.state.v2`, schemat 2; dane v1 zostają nietknięte pod starym kluczem | Model v1 (MP dla wszystkiego) nie jest kompatybilny |
| Motyw | jasny (baza: „Perła” z 1.3.0) | Wymaganie 11 |

## Pliki zmienione w v2

`demo/src/engine.js` (przepisany model), `demo/src/seed.js`, `demo/src/app.js` (formularz 3 rodzajów, pociąg, widoki), `demo/src/styles.css` (jasny motyw), `config/demo.config.json` (+`woodTPerM3`, `chipRateDefault`), `tools/build-demo.mjs`, `tests/*`, dokumentacja, instalator 2.0.0.

## Wpływ na FAZĘ 2

Tabela `stock_ledger` powinna mieć `qty numeric(14,3)` + `unit` (z CHECK zgodnym z `products.stock_unit`) zamiast jednej kolumny `mp`. Operacja = agregat z typem (`purchase | sale | production`) i flagą `direct`.

---

# Demo v2.1 — domknięcie prototypu (specyfikacja: §0–32, testy 11–42)

## Decyzje

| Wymaganie | Decyzja | Uzasadnienie |
|---|---|---|
| Produkcja na magazynie (§3, §6) | użytkownik podaje **ilość produkcji**; zużycie = produkcja ÷ przelicznik (`Units.prodFactor`, dziś tylko m³ → MP = 4) | w 2.0 było odwrotnie (podawane zużycie) — sprzeczne z §6 |
| Brak transportu w produkcji (§5) | sekcja transportu nie jest renderowana; silnik pomija walidację transportu dla `PRODUKCJA`, miejsce = magazyn | transport jest kosztem przewozu, a produkcja na placu nie ma przewozu |
| Precyzja (§31.6) | wewnętrznie 6 miejsc (`rq`), zaokrąglenie wyłącznie przy prezentacji | 250,0001 MP → 62,500025 m³ musi być zablokowane przy stanie 62,5 m³ |
| Statusy (§32.1) | `DRAFT` w osobnej kolekcji `drafts` (bez numeru i księgi); operacja: `POSTED` → `CORRECTED` / `CANCELLED` | szkic nie może zużywać numeracji ani wpływać na stan |
| Anulowanie (§32.2–32.4) | nowe zapisy księgi `ANULOWANIE` (dok. AN) z bieżącą datą, odwracające skutki netto (również wcześniejszych korekt); analiza osi czasu bez skutków dokumentu — jeśli saldo kiedykolwiek < 0 → blokada z listą operacji zależnych; przy późniejszych rozchodach bez utraty pokrycia → wymagane potwierdzenie | historia i zamknięte okresy się nie zmieniają; brak cichego „przepisania” przeszłości |
| Korekta (§32.5–32.17) | nowy dokument KOR z bieżącą datą = różnica między stanem docelowym a bieżącym skutkiem dokumentu; nowa wersja przechodzi **tę samą** walidację (`planOperation` na księdze bez korygowanego dokumentu); rodzaju operacji, daty i magazynu nie zmienia się korektą | jeden silnik walidacji; brak ścieżek „na skróty” |
| Odwrócenie korekty | nowa korekta przywracająca `inputBefore` ostatniej korekty; tylko ostatnia, nie odwrócenie odwrócenia | korekt się nie usuwa (§32.16) |
| Raport (§11, testy 11–42) | bilans z księgi (kategoria zapisu `cat` zachowuje źródło także dla KOR/AN); wartości z `valueEvents` (utworzenie / korekta / anulowanie) w dacie zdarzenia | zamknięty miesiąc pozostaje niezmienny; korekta z października jest w październiku |
| PDF (§12) | własny generator (`pdf.js`): PDF 1.7, czcionka TrueType osadzona (CIDFontType2, Identity-H), mapa ToUnicode (kopiowanie i wyszukiwanie tekstu), numeracja stron, podpisy; czcionka = podzbiór Liberation Sans przemianowany na ResInvestDocSans (OFL) | wymóg „prawdziwy dokument, nie zrzut ekranu”, polskie znaki, bez CDN |
| Jeden model treści | ekran raportu, wydruk (HTML) i PDF budowane z tego samego modelu | spójność Pulpit = Raport = PDF (test 33–35) |
| Uprawnienia (§32.22) | `documents.cancel`, `documents.correct`, `inventory.correct`, `production.correct`, `sales.correct`, `purchases.correct`, `report.view` | kierownik ma wszystkie, magazynier żadnego z nich |
| Dane | klucz `riw.demo.state.v3`, schemat 3; dane 2.0 nienaruszone | nowy model operacji (statusy, korekty) |

## Architektura Production v1 (propozycja — nie wdrożona)

| Warstwa | Propozycja |
|---|---|
| Baza | PostgreSQL 16. Tabele: `warehouses`, `products(stock_unit CHECK IN ('m3','MP','t'))`, `partners`, `users`, `roles`, `role_permissions`, `operations(id, type, status, wh_id, to_wh_id, date, no, idempotency_key UNIQUE, created_by, version)`, `operation_versions` (pełny snapshot każdej wersji — oryginał i korekty), `documents(no UNIQUE, type, op_id, status)`, `stock_ledger(id, op_id, doc_no, kind, cat, wh_id, product_id, qty numeric(18,6), unit, direct, date, created_at)` **append-only** (REVOKE UPDATE/DELETE, trigger blokujący), `corrections`, `cancellations`, `value_events`, `inventory_periods`, `audit_log` (append-only, hash łańcuchowy), `drafts`, `number_series` |
| Spójność | jedna transakcja na operację: `SELECT … FOR UPDATE` na wierszach `stock_balance(wh_id, product_id)` (lub `SERIALIZABLE` + ponowienie), kontrola salda < 0 w bazie (CHECK na `stock_balance`), numeracja z `number_series` w tej samej transakcji, `idempotency_key` UNIQUE; zamknięte okresy — CHECK / trigger na dacie zapisu |
| Serwer | NestJS (TypeScript): moduły `operations`, `corrections`, `cancellations`, `ledger`, `reports`, `inventory`, `fleet`, `auth`; silnik domenowy z `engine.js` przeniesiony do czystego modułu TS (te same testy jako kontrakt); walidacja wyłącznie po stronie serwera, klient dostaje `plan` do podglądu |
| Uprawnienia | JWT + role; uprawnienia sprawdzane w guardach i ponownie w usłudze domenowej; przypisanie użytkownik ↔ magazyny (wiele magazynów na użytkownika) |
| Raporty i PDF | zapytania agregujące po `stock_ledger` i `value_events` (widoki materializowane na miesiąc zamknięty); PDF generowany na serwerze z tego samego modelu treści (np. pdfkit / obecny generator), numer raportu z serii `RAP`, archiwum wygenerowanych PDF z sumą kontrolną |
| Wycena | średnia ważona ruchoma lub FIFO per magazyn × produkt, z kosztem rąbania i transportu doliczanym do PW/PZ — decyzja biznesowa do potwierdzenia |
| Kopie i odtwarzanie | pg_dump dzienny + WAL (PITR), test odtworzenia co miesiąc; eksport CSV/JSON z UI |
| Migracja | import 1.3.0 (IndexedDB/Supabase) → bilans otwarcia per magazyn × produkt na dzień startu + archiwum dokumentów tylko do odczytu |
| Klient | React (lub rozwinięcie obecnego UI jako SPA) z tymi samymi ekranami; tryb offline — poza zakresem v1 |

## Ryzyka / pytania do firmy przed Production v1

1. Masa drewna 0,952 t/m³ (z przykładu 817 m³ ≈ 778 t) vs 1,32 t/m³ z v1 — do potwierdzenia.
2. Przykłady GJ w specyfikacji liczone z masy zaokrąglonej (778 × 8,5 = 6 613) — system liczy z masy dokładnej (6 611). Do potwierdzenia, który wynik ma być na dokumentach.
3. Sprzedaż bezpośrednia z niesprzedaną resztą — reszta trafia na stan (z ostrzeżeniem). Alternatywa: blokada. Do decyzji.
4. Korekta daty dokumentu i zmiana magazynu — obecnie tylko przez anulowanie i nowy dokument.
5. Metoda wyceny magazynu (średnia / FIFO) i czy koszt rąbania/transportu wchodzi do wartości zapasu.

---

## FAZA 2 — zrealizowana (ResInvest ERP 3.0.0)

### Zakres (zlecenie)
„Podrasuj i popraw graficznie pulpit główny, zbuduj kompletny program z systemem logowania, z kompletnymi językami
(PL/CS/EN) i motywami jasnym, ciemnym i azure — jak w 1.3.0.”

### Architektura

```
            ┌──────────────── ResInvest_ERP.html (jeden plik) ────────────────┐
            │ i18n + słowniki → engine (silnik) → service (komendy) → UI       │
            │                         ▲                                        │
            │           Store.exec(cmd, args) — jedyna ścieżka zmian           │
            └───────────────┬───────────────────────────────┬──────────────────┘
          tryb lokalny      │                               │  tryb serwera (/api/health → "resinvest-erp")
  LocalBackend: localStorage│                               │ ServerBackend: fetch /api/cmd, SSE /api/events
  + Web Locks, LocalAuth    │                               ▼
  (PBKDF2, sesja karty)     │                 server/riw-server.mjs (HTTP/HTTPS, CSRF, CSP, sesje, limity)
                            │                 server/core.mjs: Store (node:sqlite, WAL, synchronous=FULL)
                            │                   tabele: meta · state (JSON + sha256) · journal (append-only,
                            │                   łańcuch sha256) · accounts (scrypt) · sessions (skrót tokenu)
                            │                   · login_log;  ten sam engine.js + service.js co w przeglądarce
```

### Decyzje

| Decyzja | Uzasadnienie |
|---|---|
| Jeden plik HTML dla obu trybów; wykrycie serwera przez `/api/health` | jedna wersja interfejsu do utrzymania; tryb lokalny zostaje do szkoleń i pracy jednoosobowej |
| Warstwa usług `RIW.Service` wspólna dla przeglądarki i serwera | reguły biznesowe i uprawnienia wykonywane identycznie; serwer nie ufa przeglądarce (użytkownik z sesji) |
| Komenda na kopii stanu, zapis tylko przy `ok` i zmianie rewizji | „wszystko albo nic” w obu trybach; na serwerze jedna transakcja: stan + rewizja + dziennik |
| Stan jako dokument JSON + dziennik zmian (nie tabele relacyjne) | brak podwójnej implementacji logiki (silnik jest w JS); wydajność wystarczająca dla skali firmy; rozbicie na tabele możliwe bez zmiany API komend |
| Node.js ≥ 22.13 z wbudowanym `node:sqlite` | zero zależności npm, instalator dołącza jeden `node.exe` |
| Hasła: serwer scrypt (N=32768), lokalnie PBKDF2-SHA256 (Web Crypto + zapas w JS) | standardowe funkcje wyprowadzania kluczy; hasła nigdy w stanie ani w kopii JSON |
| Sesja: losowy token 256 bit, w bazie tylko skrót; ciasteczko HttpOnly, SameSite=Strict; bezczynność 30 min, maks. 12 h | odporność na kradzież z bazy i XSS; wygasanie |
| CSRF: nagłówek `X-RIW: 1` + zgodność `Origin` | wymusza preflight dla obcych stron |
| i18n: tekst polski jest kluczem; teksty zapisane w danych kanonicznie po polsku (`{k, p}`), tłumaczone przy wyświetlaniu | audyt i dokumenty czytelne w każdym języku, bez migracji danych przy dodaniu języka |
| Słowniki `i18n.dNN.js` (pary CS/EN) + `tools/i18n-extract.mjs` + test pokrycia | brak tłumaczenia = błąd testu, nie „cichy” polski tekst |
| Motywy przez tokeny CSS (`[data-theme]`), palety wykresów zwalidowane (CVD, kontrast) | spójność 3 motywów; czytelność wykresów dla osób z daltonizmem |
| Schemat danych 4 (loginy, preferencje, flagi `active`) z migracją 3 → 4 | zgodność z kopiami i danymi Demo 2.x |

### Pliki

| Plik | Rola |
|---|---|
| `app/src/i18n.js`, `i18n.d01–d10.js` | tłumaczenia, liczba mnoga, formaty liczb i dat |
| `app/src/service.js` | komendy (operacje, korekty, anulowania, inwentaryzacja, flota, kartoteki, użytkownicy, preferencje, import/reset) |
| `app/src/auth.js` | hasła, polityka haseł, logowanie lokalne, blokady, dziennik logowań |
| `app/src/core.js` | Store/backendy, logowanie i ekrany uwierzytelniania, nawigacja, motywy, języki |
| `app/src/form.js`, `views.js`, `dashboard.js`, `admin.js` | formularz operacji, moduły, nowy pulpit, kartoteki / użytkownicy / administracja |
| `server/core.mjs`, `server/riw-server.mjs` | serwer (SQLite, sesje, API, kopie, CLI) |
| `config/server.config.json` | konfiguracja środowiska serwera |
| `installer/ResInvestERP.iss`, `build-installer.ps1`, `scripts/*.cmd` | instalator Windows z serwerem i Node.js |
| `tests/platform.test.mjs`, `tests/server.test.mjs` | nowe testy platformy i serwera |

### Ryzyka i pytania

* Jednoczesna edycja: serwer serializuje komendy (jeden proces, transakcje), a przeglądarki dostają nowy stan przez SSE;
  formularz w toku nie jest nadpisywany — przy zatwierdzeniu silnik ponownie sprawdza stany (brak ujemnych stanów).
* Wielkość stanu JSON: przy ~100 tys. operacji rozważyć tabele relacyjne i przyrostowe przesyłanie zmian (API bez zmian).
* HTTPS: w sieci lokalnej opcjonalny; przy dostępie z internetu wymagany (`tls.cert/key`) + reverse proxy.
* Do decyzji firmy (bez zmian od fazy 1): masa drewna 0,952 t/m³, sposób liczenia GJ, docelowa metoda wyceny.

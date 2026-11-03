# ResInvest ERP — audyt repozytorium i plan przebudowy 4.0

Data: 2026-09-30 · Stan wyjściowy: **ResInvest ERP 3.3.0** (commit `519c205`)
Podstawa: *RESINVEST ERP — MASTER PROMPT* (§1–§35). Zgodnie z §35 dokument powstał **przed** zmianami w kodzie.

---

## 1. Mapa repozytorium (stan faktyczny, odczytany z kodu)

| Obszar | Gdzie | Jak działa dziś |
|---|---|---|
| **Frontend** | `app/src/*.js` (≈ 7 000 wierszy JS, bez TypeScript) → `tools/build.mjs` → **jeden plik `ResInvest_ERP.html` (5,5 MB)** | vanilla JS, własny router hash (`#/…`), szablony w stringach, wbudowany film intro (base64), czcionki PDF, słowniki PL/CS/EN |
| **Backend** | `server/riw-server.mjs` (HTTP, `node:http`), `server/core.mjs` (baza, sesje, konta), `server/mail.mjs` | Node 22, bez frameworka; jedno wejście zmian: `POST /api/cmd` → `Service.run(state, cmd, args)` |
| **Baza** | SQLite (`node:sqlite`, WAL, `synchronous=FULL`) | **cały stan biznesowy = jeden dokument JSON** w tabeli `state(id=1)` (stan z dnia audytu; od 3.10 rekordy w tabeli `rows`, zapis przyrostowy); osobne tabele: `accounts`, `sessions`, `login_log`, `tokens`, `outbox`, `journal` (łańcuch SHA-256) |
| **Tryb lokalny (OFFLINE)** | `app/src/core.js` (`LocalBackend`) | **dane biznesowe w `localStorage` przeglądarki** |
| **Modele / reguły** | `app/src/engine.js` (2 300 wierszy) — wspólny dla przeglądarki i serwera | walidacja, plan operacji, księga (ledger), korekty, anulowania, MM dwuetapowe, inwentaryzacja, raporty, migracje schematu (obecnie **7**) |
| **API** | `server/riw-server.mjs` | `/api/auth/*` (login, logout, me, password, forgot, reset, token, confirm, register), `/api/invite/accept`, `/api/users/*`, `/api/state`, `/api/cmd`, `/api/events` (SSE), `/api/backups`, `/api/health`, `/api/setup`, `/api/audit/extra` |
| **Auth** | `server/core.mjs`, `app/src/auth.js` | hasła **scrypt** (serwer) / PBKDF2 (lokalnie), sesja w ciasteczku HttpOnly, blokada po 5 próbach, rate limit na IP, zaproszenia i reset linkiem (tokeny jednorazowe, skrót w bazie), domena `@resinvest.group` sprawdzana na serwerze |
| **Uprawnienia** | `engine.js` (`PERMS`, `ROLES`, `can`, `whAccess`), `service.js` (`project`) | role ADMINISTRATOR / MANAGER / MAGAZYNIER / OBSERWATOR / AUDYTOR, edytowalne zestawy uprawnień, izolacja magazynów (projekcja stanu po stronie serwera) |
| **Audyt** | `engine.js` (`audit()` → `state.audit[]`), `journal` w SQLite, `login_log`, `outbox` | kod zdarzenia, stan przed/po, IP, User-Agent; dziennik w **tym samym dokumencie JSON** co dane |
| **Magazyny** | `state.warehouses[]` | 3 magazyny RiC (Zabrze, Brąszewice, Rokitki), użytkownik: magazyn domyślny + dostępne |
| **Produkcja** | `engine.js` `planProduction` | 3 ścieżki: z zakupu (łańcuch), na magazyn (RW+PW), bezpośrednia (las → WZ); rębak + operator, koszt rąbania |
| **PZ / WZ** | `engine.js` `nextNo()` | **numeracja automatyczna** `PZ/001/09/2026` (licznik w `state.seq`); numer dokumentu zewnętrznego — pole `extDoc` |
| **Sprzedaż** | `engine.js` (sekcja SPRZEDAZ) | ilość w MP / t (wg dozwolonych jednostek produktu), cena za MP lub t; masa orientacyjna z przelicznika — **bez tonażu ręcznego i bez źródła tonażu** |
| **Flota** | `state.fleet.{vehicles,drivers,chippers,operators}` | pojazdy, kierowcy, rębaki (tylko własne), operatorzy; przypisanie do magazynu |
| **Transport** | `engine.js` | własny / zewnętrzny / mieszany / kolej / zapewnia dostawca; kursy, kwity wywozowe, km × stawka, fracht, dokument TR |
| **Raporty** | `engine.js` `Reports` + `views.js` | okresowe (dzień–rok), bilans stanów z kontrolą spójności, zakupy, produkcja, sprzedaż, MM, transport, korekty, anulowania, wycena, drill-down |
| **Eksporty** | `views.js` (`toCSV`), `pdf.js` (własny generator PDF) | **CSV** i **PDF/druk**; **brak XLSX i DOCX** |
| **E-mail** | `server/mail.mjs` | Resend API / SMTP / plik `.eml`; tylko poczta kont (zaproszenie, reset, potwierdzenie); tabela `outbox` bez kolejki z ponowieniami; **brak powiadomień o dokumentach** |
| **Deployment** | `installer/ResInvestERP.iss` (Inno Setup), `build-installer.ps1`, `build-installer-wine.sh` | Windows: serwer Node jako proces + skróty; `ResInvestERP-Otworz.cmd` otwiera okno Edge/Chrome |
| **Docker** | — | **brak** |
| **Konfiguracja Windows** | `installer/scripts/*.cmd`, `C:\ProgramData\ResInvestERP\server.env` | brak usługi Windows, brak HTTPS (plan w `docs/ARCHITECTURE_WINDOWS_PLAN.md`) |
| **Testy** | `tests/` | `node:test`: engine 76, pdf 4, platform 33 (razem 113), server 9, auth 26; Playwright: e2e 202, e2e-server 24, e2e-intro 15 — **wszystkie przechodzą na 3.3.0** |

---

## 2. Ocena względem MASTER PROMPT

Legenda: ✅ spełnia · 🟡 do poprawy · 🔁 do przebudowy · ❌ brak

| § | Wymaganie | Stan | Uwagi |
|---|---|---|---|
| 1 | React + TS + Vite, NestJS, PostgreSQL, Prisma, Tauri, Nginx, Docker Compose | 🔁 | obecnie vanilla JS, Node bez frameworka, SQLite z dokumentem JSON, Inno Setup |
| 1 | Baza nie na udziale sieciowym | ✅ | SQLite lokalnie na serwerze; kopie mogą iść na dysk firmowy |
| 2 | TLS, nagłówki, CORS, rate limit, brute force | 🟡 | nagłówki bezpieczeństwa i CSP są; rate limit tylko dla endpointów logowania; **brak HTTPS** (HTTP w LAN) |
| 2 | Entra ID / LDAP w przyszłości | ❌ | brak warstwy dostawcy tożsamości |
| 2 | Backend sprawdza uprawnienia | ✅ | każda komenda — `Service.exec` + silnik |
| 3 | Transakcje, konflikty, idempotencja, atomowość | 🟡 | atomowość i idempotencja są (kopia stanu, `idemKey`), ale **cały stan w jednym JSON = globalna serializacja zapisów**, pełny zapis dokumentu przy każdej zmianie; nie skaluje się |
| 4 | Rejestracja, aktywacja, reset, blokada, sesje | ✅/🟡 | jest; brak **listy aktywnych sesji** dla użytkownika / administratora |
| 4 | Inicjalizacja administratora (nie na sztywno) | ✅ | `/api/setup`, seed konfigurowalny |
| 5 | Wiele magazynów, `warehouse_id` w każdym rekordzie, izolacja | ✅ | projekcja stanu po stronie serwera |
| 6 | Administracja → Bilans otwarcia (zatwierdzanie, historia) | ❌ | `openingBalance()` istnieje tylko dla danych przykładowych, bez UI i bez obiegu zatwierdzania |
| 7 | Przeliczniki konfigurowalne, zapis źródła AUTO/MANUAL/COMPANY_RATE | 🟡 | przeliczniki w konfiguracji i kartotece produktu; źródło zapisywane tylko dla masy zakupu i tonażu MM |
| 8 | Sprzedaż w MP/m³/t + tonaż AUTO/RĘCZNY | ✅ | 3.4.0: tonaż AUTO (przelicznik) / RĘCZNY (waga) zapisany na WZ ze źródłem, np. „60 MP \| 20,35 t \| RĘCZNY”; korekta zachowuje tryb |
| 9 | Nazwa „PRODUKCJA NA MAGAZYNIE” | ✅ | zmienione w 3.x z „Produkcja na magazyn” (etykiety, pulpit, formularz, listy, słowniki CS/EN, testy); w 4.0 od początku |
| 10 | Numery PZ/WZ wpisywane ręcznie, osobne daty dokumentu/przyjęcia/utworzenia | ✅ | 3.4.0: numer ręczny z podpowiedzią, unikalny dla typu + magazynu + roku; data dokumentu, data przyjęcia/wydania (data operacji) i `createdAt` |
| 11 | Otwórz / Podgląd / Koryguj / Usuń, BYŁO/JEST | ✅ | 3.4.0: akcje w rejestrach; „Usuń” = soft delete z powodem (odwrócenie ruchów dokumentem AN, dokument w historii i audycie, uprawnienie `documents.delete`); PZ zielone, WZ złote |
| 12 | Wydruk, PDF, CSV, **XLSX**, **DOCX** | ✅ | 3.4.0: XLSX i DOCX tworzone w programie (rejestry, operacje, raporty, podgląd dokumentu) |
| 13–14 | Operacje dodatkowe + kartoteka | ✅ | 3.4.0: pole „Dodaj operację dodatkową” w produkcji; pozycje jako osobne rekordy z `opId`; kartoteka w bazie (Kartoteki → Dodatkowe operacje) |
| 15 | Rębaki firm zewnętrznych | ✅ | 3.4.0: właściciel (własny / firma), firma, nr rej., operator opisowo; w produkcji osobna grupa na liście |
| 16 | Kafel „Operacje dodatkowe” na pulpicie | ✅ | 3.4.0: wybór miesiąca, koszt, liczba, lista; te same liczby w raporcie miesięcznym |
| 17 | Powiadomienia e-mail o zdarzeniach, kolejka, retry | ❌/🟡 | poczta kont działa; brak powiadomień, brak kolejki z ponowieniem |
| 18 | CSV/XLSX szczegółowe, kolumny rozdzielone | 🟡 | CSV są, ale część kolumn łączy informacje (np. „Treść”) |
| 19 | Stan wyłącznie z operacji, brak ujemnego przy równoczesnej sprzedaży | ✅ | księga append-only, symulacja sald; równoczesność bezpieczna, bo zapisy są serializowane (koszt: brak równoległości) |
| 20 | Centralny audyt, niedostępny do usuwania | 🟡 | audyt jest, ale w tym samym JSON co dane (administrator importem kopii może go zastąpić) |
| 21 | PostgreSQL: UUID, FK, indeksy, constraints, UTC, migracje | 🔁 | brak modelu relacyjnego |
| 22 | Backup: 2 kopie, retencja, weryfikacja, restore, test odtworzenia | 🟡 | kopie SQLite (start + codziennie, retencja, `--check`); jedna lokalizacja; brak automatycznego testu odtworzenia |
| 23 | Przeglądarka, Windows `.exe` (Tauri), telefon/PWA | 🟡 | przeglądarka i telefon (responsywnie) działają; Windows = instalator serwera + okno przeglądarki; **brak PWA i Tauri** |
| 24 | Semantyczny HTML, nie jeden ogromny plik HTML | 🔁 | aplikacja budowana do jednego pliku |
| 25 | Moduły: Sprzedaż, Zakupy, Korekty, Edytowane, KZR, Powiadomienia… | 🟡 | brakuje osobnych modułów Zakupy/Sprzedaż/Korekty/Edytowane/KZR/Powiadomienia |
| 26 | Centralny rejestr dokumentów z filtrami | ✅/🟡 | rejestr jest; brak filtra po użytkowniku i materiale |
| 27 | Walidacja front + back, czytelne błędy | ✅ | jedno źródło reguł (silnik) po obu stronach |
| 28 | Testy unit/integration/E2E/multi-user/obciążeniowe/mobile | 🟡 | unit/E2E/mobile są; brak testów PostgreSQL, obciążeniowych, awarii |
| 29 | Testy awarii (DB, SMTP, restart, restore, migracja) | 🟡 | częściowo (błąd SMTP, integralność); brak scenariuszy restartu/restore |
| 33 | TypeScript / ESLint bez błędów | ❌ | projekt w JavaScript, bez ESLint |

**Co już spełnia wymagania i warto przenieść 1:1 (jako specyfikację):** reguły domenowe silnika (przeliczniki, produkcja,
transport, kwity, MM dwuetapowe, korekty z deltami, anulowanie z analizą zależności, inwentaryzacja i zamknięcie okresu,
raporty z kontrolą spójności), model uprawnień i izolacji magazynów, mechanika zaproszeń/resetu, szablony e-mail,
słowniki PL/CS/EN, scenariusze testowe (≈ 450 kontroli) jako zestaw regresyjny.

---

## 3. Najważniejsze ustalenia

1. **Architektura danych nie spełnia §1, §3, §21:** stan biznesowy to jeden dokument JSON. Każda zmiana serializuje
   i zapisuje całość (dziś ~150 kB danych przykładowych; po kilku latach — dziesiątki MB), zapisy są globalnie
   szeregowane, nie ma FK, indeksów ani ograniczeń na poziomie bazy.
2. **Tryb OFFLINE trzyma dane biznesowe w `localStorage`** — sprzeczne z §32. W 4.0 tryb lokalny znika
   (jedno źródło danych: PostgreSQL); do szkoleń — osobna baza szkoleniowa.
3. **Frontend jako jeden plik HTML** — sprzeczne z §24; brak typowania.
4. **Brak HTTPS i usługi Windows** — praca w sieci firmowej tylko przez HTTP (ryzyko przy VPN ograniczone, ale niezgodne z §2).
5. **Kopie zapasowe w jednym miejscu** — §22 wymaga dwóch kopii i testu odtworzenia; dwa katalogi na tym samym
   dysku fizycznym to ryzyko infrastrukturalne (do zapisania w dokumentacji wdrożenia).

**Decyzja (§1, §4 kolejności): PRZEBUDOWA z migracją danych**, nie łatanie. Metoda „strangler”: wersja 3.3 pozostaje
produkcyjna do dnia przełączenia; 4.0 powstaje obok w tym samym repozytorium; narzędzie migracji przenosi dane
3.x (kopia JSON / baza SQLite) do PostgreSQL z raportem zgodności stanów (każdy magazyn × produkt: 3.x = 4.0).

---

## 4. Architektura docelowa 4.0

```
Windows / laptop / telefon
   │  przeglądarka · ResInvest ERP.exe (Tauri, ten sam frontend) · PWA
   ▼
FortiClient VPN → FortiGate (reguła: tylko pula VPN + LAN → 443 serwera)
   ▼
Nginx (TLS 1.2+/1.3, HSTS, nagłówki, limit żądań, statyczny frontend)
   ▼
NestJS API (REST /api/v1, OpenAPI, walidacja DTO, guardy ról i magazynów, idempotencja)
   │                     └─ worker: kolejka e-mail (retry), backup, zadania okresowe
   ▼
PostgreSQL 16+ (serwer aplikacji, dysk lokalny)  ──►  backup_primary / backup_secondary (dysk firmowy) [+ kopia poza serwerem]
```

### Struktura repozytorium (monorepo pnpm)

```
resinvest-erp/                 ← 3.3 (bez zmian do dnia przełączenia)
resinvest-erp-4/
├── apps/api/                  ← NestJS: moduły auth, users, warehouses, materials, units, partners, fleet, chippers,
│                                 documents, stock, production, sales, purchases, mm, additional-ops, corrections,
│                                 audit, notifications, reports, exports, backup, admin/opening-balance
├── apps/web/                  ← React + TS + Vite (PWA), router, TanStack Query, formularze z walidacją zod
├── apps/desktop/              ← Tauri 2 (okno natywne na frontend z serwera firmowego; instalator NSIS/MSI)
├── packages/domain/           ← reguły biznesowe w TS (przeliczniki, walidacja, plan operacji) — jedno źródło
│                                 dla API (autorytatywnie) i frontendu (podgląd „przed → po”)
├── packages/contracts/        ← DTO / schematy zod współdzielone przez API i web
├── prisma/                    ← schema.prisma + migracje
├── tools/migrate-3x/          ← import danych 3.x → PostgreSQL + raport zgodności
├── deploy/                    ← docker-compose (test/serwer), nginx, skrypty Windows (usługa, backup), runbook
└── tests/                     ← integracja (Postgres), E2E (Playwright, desktop + mobile), obciążenie (k6/autocannon), awarie
```

### Wersje (sprawdzone w rejestrze npm 2026-09-30)

| Pakiet | Najnowsza | Decyzja |
|---|---|---|
| NestJS | 12.1.2 | 12.x |
| React | 19.3.0 | 19.x |
| Vite | 8.3.1 | 8.x |
| TypeScript | 7.0.2 | 7.x — **do potwierdzenia w fazie 1** zgodność z dekoratorami NestJS; w razie problemu ostatnia 6.x |
| Prisma | `latest` = 8.0.0-rc.19 (wydanie kandydujące), `@prisma/client` 7.10.0 | **7.x stabilna** — nie wdrażamy RC w produkcji |
| Tauri CLI | 2.12.0 | 2.x |
| Playwright | 1.63.0 | 1.63 |
| exceljs / docx | 4.4.0 / 9.8.1 | XLSX / DOCX po stronie serwera |

### Model danych PostgreSQL (wstępny)

Wszystkie klucze `uuid`, czasy `timestamptz` (UTC), `created_at/created_by/updated_at/updated_by`, `version int`
(optimistic locking) w encjach edytowalnych, `deleted_at` (soft delete) tam, gdzie §11 tego wymaga.

| Grupa | Tabele (najważniejsze ograniczenia) |
|---|---|
| Tożsamość | `users` (email unique, citext; status CHECK), `user_warehouses` (PK user+warehouse), `roles`, `permissions`, `role_permissions`, `sessions` (hash tokenu, ip, ua, expires), `auth_tokens` (hash, kind, used_at), `login_events`, `identity_providers` (przygotowanie pod Entra ID/LDAP) |
| Kartoteki | `warehouses`, `materials` (jednostka magazynowa CHECK), `material_units`, `conversion_rates` (materiał / firma, obowiązuje od–do), `partners`, `external_companies`, `vehicles`, `drivers`, `chippers` (owner: OWN / EXTERNAL + FK firmy), `operators`, `additional_operation_types` |
| Dokumenty | `documents` (typ PZ/WZ/RW/PW/MM/TR/KOR/BO, **numer + typ + magazyn unique**, `document_date`, `movement_date`, `created_at`, status, `version`, `deleted_at`, `idempotency_key` unique), `document_lines` (materiał, ilość źródłowa + jednostka, ilość przeliczona + jednostka, przelicznik, źródło `AUTO/MANUAL/COMPANY_RATE`, tonaż + źródło), `operations` (logiczna operacja łącząca dokumenty), `transport_runs`, `production_runs`, `additional_operations` (FK → operations, koszt `numeric(14,2)`, pojazd FK) |
| Stany | `stock_movements` (append-only: FK dokumentu/linii, magazyn, materiał, `qty numeric(18,6) <> 0`), `stock_balances` (magazyn × materiał, `qty >= 0` CHECK, blokowane `SELECT … FOR UPDATE` w stałej kolejności), `opening_balances` (+ `opening_balance_batches` ze statusem DRAFT/APPROVED, zatwierdzający, data obowiązywania), `inventory_periods` |
| Zmiany | `document_revisions` (pole, BYŁO, JEST, powód, kto, kiedy), `audit_log` (append-only; rola aplikacji bez `UPDATE/DELETE` na tej tabeli) |
| Powiadomienia | `notification_settings` (użytkownik × zdarzenie), `mail_outbox` (status, próby, `next_attempt_at`, błąd) |
| System | `settings`, `idempotency_keys`, `backup_runs` (plik, sha256, rozmiar, wynik weryfikacji, test restore) |

Księgowanie: każda operacja magazynowa = jedna transakcja: dokument + linie + ruchy + aktualizacja `stock_balances`
pod blokadą wierszy. Dwóch użytkowników sprzedających ten sam materiał: druga transakcja czeka na blokadę i widzi
zmniejszony stan → odrzucenie z czytelnym błędem (brak stanu ujemnego; wyjątek tylko przez jawne uprawnienie + audyt).

---

## 5. Ryzyka

| Ryzyko | Wpływ | Postępowanie |
|---|---|---|
| Zakres przebudowy (≈ 38 kroków §30) | wysoki | fazy z kryteriami odbioru; 3.3 działa do przełączenia |
| Zgodność migracji danych 3.x | wysoki | narzędzie importu + raport sald 3.x = 4.0 dla każdego magazynu i materiału; próba na kopii produkcyjnej |
| Instalator Windows Tauri nie da się zbudować w tym środowisku (Linux, brak Windows SDK/NSIS) | średni | build na **runnerze Windows (GitHub Actions `windows-latest`)**; lokalnie tylko build Linux i testy frontendu |
| Brak demona Docker w środowisku budowania | średni | Docker Compose przygotowany i zweryfikowany składniowo; testy integracyjne na lokalnym PostgreSQL 16 (dostępny tutaj) |
| TypeScript 7 / Prisma 8 RC | średni | stabilne linie (Prisma 7.x); TS 7 tylko po teście zgodności |
| Serwer firmy: system operacyjny, certyfikat TLS, reguły FortiGate | średni | runbook wdrożenia; certyfikat z firmowego CA lub Let's Encrypt (DNS) — decyzja IT |
| Dwie kopie na tym samym dysku fizycznym | średni | zapisane jako ryzyko; zalecana trzecia kopia poza serwerem |
| Rozbieżność §10 (ręczne numery PZ/WZ) i §11 („Usuń”) z dotychczasowymi zasadami 3.x | średni | wymaga decyzji — pytania w §7 |

---

## 6. Kolejność implementacji (fazy)

| Faza | Zakres (§30) | Kryterium odbioru |
|---|---|---|
| **F1 Fundament** | monorepo, TS, ESLint, Prisma schema + migracja 0001, NestJS szkielet, konfiguracja `.env`, healthcheck, Docker Compose, CI | `pnpm build`, `lint`, `test` bez błędów; migracja na czystym PostgreSQL |
| **F2 Tożsamość** | auth (Argon2id), sesje + lista aktywnych sesji, role/uprawnienia, magazyny użytkownika, inicjalizacja administratora, rate limit, audyt | testy integracyjne auth + §34/§35 przeniesione z 3.x |
| **F3 Silnik stanów** | `packages/domain` (port reguł z `engine.js`), `stock_movements`/`stock_balances`, bilans otwarcia z zatwierdzaniem | testy jednostkowe przeliczników i księgowania; test równoległej sprzedaży |
| **F4 Dokumenty** | PZ/WZ (numery wg decyzji), zakup, sprzedaż (MP/m³/t + tonaż AUTO/RĘCZNY), produkcja na magazynie, MM dwuetapowe, rębaki własne/zewnętrzne, flota, transport, operacje dodatkowe + kartoteka | scenariusze E2E z 3.x przeniesione i zielone |
| **F4c Planer zakupów** | zakładka „Planer zakupów”: plan dzienny [MP] wpisywany ręcznie (tabela `purchase_plans` z historią zmian), wykonanie MP, tony (waga kursu, inaczej przelicznik firmowy **0,33 t/MP** — decyzja 2026-10-01), cena i wartość zakupu, km, transport i kursy kierowców czytane z PZ / PW / TR; widoki tydzień, miesiące i rok, kierowcy i kursy; drill-down do dokumentów; prototyp `resinvest-erp-4/docs/prototypy/planer-zakupow.html` | testy agregatów (API) + E2E planera |
| **F5 Zmiany** ✅ | korekty (BYŁO/JEST), usuwanie (wg decyzji), historia zmian, zakładki „Korekty” i „Edytowane” (+ „Usunięte”) — wykonane 2026-10-01, raport `resinvest-erp-4/docs/RAPORT_F5.md` | testy integracyjne audytu |
| **F6 Raporty i eksporty** ✅ | rejestr dokumentów z filtrami, raporty okresowe, CSV/XLSX/PDF/DOCX, pulpit z kaflem „Operacje dodatkowe” — wykonane 2026-10-01, raport `resinvest-erp-4/docs/RAPORT_F6.md` | porównanie liczb raportów z 3.x na tych samych danych |
| **F7 Powiadomienia** ✅ | ustawienia użytkownika, kolejka, retry, log wysyłki; błąd e-mail nie cofa operacji — wykonane 2026-10-01, raport `resinvest-erp-4/docs/RAPORT_F7.md` | test awarii SMTP |
| **F8 Klienci** ✅ | PWA (telefon), Tauri (Windows), build instalatora na runnerze Windows; poczta Resend + zapasowy SMTP — wykonane 2026-10-02, raport `resinvest-erp-4/docs/RAPORT_F8.md` | E2E desktop + mobile + PWA, testy Rust |
| **F9 Eksploatacja** | backup A/B + weryfikacja + test restore, migracja danych 3.x, monitoring/logi, Nginx/TLS, usługa Windows, runbook | test odtworzenia; raport zgodności migracji |
| **F10 Jakość** | testy wieloużytkownikowe, obciążeniowe, awarii, security review, UX review, poprawki, dokumentacja administratora i wdrożenia | raport końcowy §34 |

---

## 7. Decyzje (podjęte 2026-09-30)

| Temat | Decyzja |
|---|---|
| Numery PZ/WZ (§10) | **ręczny numer + podpowiedź** kolejnego wolnego numeru; unikalność: typ + magazyn + rok; każdy dokument ma też wewnętrzny identyfikator UUID |
| „Usuń” (§11) | **soft delete z automatycznym odwróceniem ruchów** magazynowych; tylko Administrator i Manager, z powodem; blokada, gdy towar z dokumentu został już wydany; dokument pozostaje w audycie i w zakładce „Usunięte” |
| Serwer produkcyjny | **Windows Server** — PostgreSQL, API (NestJS) i Nginx jako usługi Windows; kopie na dysk firmowy |
| Build instalatora `ResInvest ERP.exe` | **GitHub Actions** — workflow z runnerem `windows-latest` w tym repozytorium |

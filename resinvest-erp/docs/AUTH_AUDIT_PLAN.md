# ResInvest ERP — uwierzytelnianie, użytkownicy, role, uprawnienia
## ETAP 1: AUDYT · ETAP 2: PLAN (bez implementacji)

Dotyczy specyfikacji „Wdrożenie logowania, użytkowników, ról, uprawnień i administracji”.
Stan kodu: wersja 3.1.0. Zgodnie z §43 i §46 specyfikacji najpierw audyt i plan — implementacja po akceptacji decyzji z §3 poniżej.

---

## 1. AUDYT — stan faktyczny

### 1.1 Stack (rzeczywisty, nie zakładany)

| Warstwa | Specyfikacja zakłada | Projekt faktycznie ma |
|---|---|---|
| Frontend | React + TypeScript | Jeden plik `ResInvest_ERP.html` budowany z modułów JS (`app/src/*.js`, bez frameworka), routing przez `#/…` |
| Backend | NestJS + TypeScript, REST | `server/riw-server.mjs` + `server/core.mjs` — Node.js ≥ 22.13, REST `/api/*`, bez zależności npm |
| Baza | PostgreSQL (+ Prisma) | SQLite (`node:sqlite`, WAL, `synchronous=FULL`); stan danych jako dokument JSON z sumą SHA-256 + dziennik zmian append-only z łańcuchem skrótów |
| Auth | Supabase Auth | Własny: hasła **scrypt** (serwer) / PBKDF2 (tryb lokalny), sesja: losowy token 256 bit, w bazie tylko skrót, ciasteczko HttpOnly + SameSite=Strict, bezczynność 30 min, maks. 12 h |
| E-mail | Supabase Auth + SMTP Resend | **Brak wysyłki e-mail** |
| Logika domenowa | — | `app/src/engine.js` + `app/src/service.js` — **ten sam kod wykonuje przeglądarka i serwer**; serwer jest źródłem prawdy |
| Tryby | OFFLINE / FIRMOWY | tryb lokalny (plik HTML, dane w przeglądarce) / tryb serwera (LAN, instalator Windows) |
| Docker | — | brak (instalator Windows z Node.js) |
| TypeScript / lint | tsc, lint | JavaScript; `node --check`, ESLint dostępny globalnie; brak `tsc` |

### 1.2 Istniejące uwierzytelnianie i użytkownicy (3.1.0)

* Logowanie e-mailem firmowym; domena z konfiguracji (`companyDomains: ["resinvest.group"]`), **sprawdzana w silniku po stronie serwera** (`companyEmail()` w `engine.js`).
* Administrator `magazyn@resinvest.group`; na serwerze tworzony w kreatorze pierwszego uruchomienia (hasło podaje administrator — **nie ma hasła w kodzie**). Hasło `demo1234` istnieje wyłącznie w danych przykładowych trybu lokalnego.
* **Rejestracja samodzielna** z ekranu logowania → konto „oczekuje na zatwierdzenie”, administrator nadaje rolę i magazyn.
* Blokada po 5 błędnych hasłach (15 min), limit prób z adresu IP, wymuszona zmiana hasła tymczasowego, reset hasła przez administratora (bez e-maila), `--reset-password` z konsoli serwera.
* Ochrona ostatniego administratora (degradacja, dezaktywacja, usunięcie), zakaz zmiany własnej roli.
* CSRF: nagłówek `X-RIW` + kontrola `Origin`; CSP i nagłówki bezpieczeństwa.

### 1.3 Role i uprawnienia

* Role: `admin`, `kierownik`, `magazynier`, `obserwator` (kod), etykiety PL/CS/EN.
* Warstwa uprawnień istnieje (`PERMS`: 17 uprawnień, np. `op.create`, `op.approve`, `documents.cancel`, `users.manage`, `report.view`), ale **mapowanie rola → uprawnienia jest stałe w kodzie** (nie ma edycji ról / uprawnień przez administratora).
* Uprawnienia sprawdza `Service.exec` (każda komenda) i ponownie silnik — **po stronie serwera**. Użytkownik pochodzi wyłącznie z sesji (argumenty `user`, `userId`, `role` z przeglądarki są ignorowane — pokryte testem).
* Obieg zatwierdzania: magazynier przekazuje operację, kierownik swojego magazynu zatwierdza / odrzuca.

### 1.4 Magazyny

* RiC Zabrze, RiC Brąszewice, RiC Rokitki (seed bez duplikatów, identyfikatory stałe).
* Użytkownik ma **jeden** magazyn (`whId`); administrator przełącza magazyn roboczy. **Brak listy „dostępnych magazynów”.**
* Magazyn operacji wynika z sesji (magazyn użytkownika w bazie) — `warehouse_id` z przeglądarki nie jest używany do zapisu.

### 1.5 Audyt

* Jeden dziennik audytu w danych (`state.audit`): kto, kiedy, akcja, przed/po, powód, źródło — obejmuje operacje, korekty, anulowania, kartoteki, użytkowników.
* Na serwerze dodatkowo dziennik komend (`journal`) z łańcuchem SHA-256, tabele zablokowane wyzwalaczami przed UPDATE/DELETE, oraz dziennik logowań (`login_log`: IP).
* Brak kodów zdarzeń w stylu `USER_INVITED`, brak `ip_address` / `user_agent` w `state.audit`.

### 1.6 Konflikty ze specyfikacją

| # | Konflikt | Waga |
|---|---|---|
| K1 | Specyfikacja zakłada React/NestJS/PostgreSQL/Prisma/Supabase — w projekcie ich nie ma. Pełne dostosowanie = przepisanie aplikacji (sprzeczne z §1 „nie przepisuj”, §42, §46). | krytyczny |
| K2 | **Izolacja danych magazynów:** `GET /api/state` wysyła **cały stan wszystkich magazynów** każdemu zalogowanemu; ograniczenie do magazynu robi tylko interfejs. Zapis jest chroniony, **odczyt obcego magazynu — nie** (§15, §17, test §35.4). | **krytyczny (bezpieczeństwo)** |
| K3 | Brak wysyłki e-mail → brak zaproszeń, potwierdzenia adresu, resetu hasła przez e-mail (§6, §25–27). | wysoki |
| K4 | Rejestracja samodzielna istnieje (wprowadzona na prośbę z 3.1); specyfikacja: tylko zaproszenia (§6, §42). | średni — decyzja |
| K5 | Brak roli AUDYTOR; role/uprawnienia niekonfigurowalne (§8, §14). | średni |
| K6 | Jeden magazyn na użytkownika zamiast „domyślny + dostępne” (§15). | średni |
| K7 | Statusy kont: `active/pending` + blokada czasowa zamiast `INVITED/ACTIVE/SUSPENDED/DISABLED` (§22). | niski |
| K8 | Audyt bez kodów zdarzeń, IP, user-agent; brak widoku `/admin/audit` (§23). | niski |
| K9 | Tryb lokalny (OFFLINE) trzyma wszystkie dane w jednej przeglądarce — izolacji magazynów i ochrony przed właścicielem komputera nie da się tam zapewnić (natura trybu). | informacyjny |
| K10 | Supabase Auth wymaga internetu i konta w chmurze; serwer firmowy działa dziś także bez internetu (LAN). | decyzja |

### 1.7 Ryzyka

* Zmiana K2 (projekcja danych per użytkownik) dotyka synchronizacji na żywo (SSE) i raportów „wszystkie magazyny” — wymaga testów regresji.
* Wysyłka e-mail zależy od zewnętrznej usługi (Resend) i DNS domeny `resinvest.group` — tego nie da się zweryfikować w środowisku deweloperskim bez klucza; testy użyją transportu testowego (zapis wiadomości do pliku).
* Migracja statusów i ról musi zachować zgodność z kopiami JSON 3.0/3.1 (schemat 5 → 6).

---

## 2. PLAN — najmniejsza bezpieczna zmiana (wariant zalecany A)

**Zasada:** rozszerzamy istniejący, działający mechanizm (serwer Node + SQLite + silnik wspólny), nie przepisujemy aplikacji
i nie tworzymy drugiego systemu Auth. Supabase — opcjonalnie w przyszłości jako zewnętrzny dostawca tożsamości (wariant B).

### Database (SQLite, migracja schematu 5 → 6, bez kasowania danych)
* Nowa tabela `tokens` (zaproszenia, reset hasła, potwierdzenie e-mail): skrót tokenu, typ, użytkownik, ważność, użycie — tokeny jednorazowe, 48 h / 1 h.
* Tabela `outbox` (kolejka e-maili z ponawianiem i statusem wysyłki) — błąd wysyłki nie aktywuje konta (§41).
* Profil użytkownika: `status` (`INVITED/ACTIVE/SUSPENDED/DISABLED`), `firstName/lastName`, `defaultWarehouseId`, `warehouseIds[]`; migracja z `active/pending/whId`.
* Role i uprawnienia w danych: `roles` z listą uprawnień (edytowalne przez administratora; `ADMINISTRATOR` zawsze pełny, niezmienialny).
* Audyt: rozszerzenie **istniejącego** `state.audit` o `code` (np. `USER_INVITED`, `ROLE_CHANGED`, `WAREHOUSE_ACCESS_CHANGED`, `PASSWORD_RESET_REQUESTED`), `ip`, `userAgent` — bez drugiego systemu historii (§24).

### Auth / Backend (server/*.mjs, service.js, engine.js)
* Endpointy: `POST /api/auth/forgot` (zawsze ta sama odpowiedź — brak ujawniania kont), `POST /api/auth/reset`, `GET/POST /api/invite/accept`, `POST /api/users/invite`, `POST /api/users/:id/resend-invite`, `POST /api/users/:id/status`, `GET /api/audit`, `GET/POST /api/roles`.
* `normalizeEmail()` + `validateCompanyEmail()` wspólne dla silnika i serwera (dokładnie `@resinvest.group`).
* **Projekcja danych per użytkownik (K2):** `GET /api/state` i SSE zwracają tylko magazyny z `warehouseIds` użytkownika (administrator / AUDYTOR — wszystkie); komendy odrzucają operacje na magazynie spoza dostępu (403). Test §35.4.
* Rola AUDYTOR: odczyt wszystkich magazynów, raporty, historia, dziennik audytu; bez zmian danych.
* Rate limiting: logowanie (jest), reset hasła i zaproszenia (nowe).
* Rejestracja samodzielna: **wyłączona domyślnie** (`allowSelfRegistration: false`), zgodnie z §6/§42 — do decyzji.

### Email
* Moduł `server/mail.mjs` bez zależności: **Resend HTTP API** (`RESEND_API_KEY`) lub SMTP (`smtp.resend.com:465`), transport testowy `file` (zapis `.eml` w folderze danych).
* Szablony PL (HTML + tekst): zaproszenie, potwierdzenie adresu, reset hasła, zmiana e-maila, hasło zmienione, konto dezaktywowane — branding ResInvest ERP, nadawca `EMAIL_FROM`.
* Konfiguracja przez ENV (`.env.example`, `--env-file`): `APP_URL`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `SMTP_*`; sekrety tylko w pliku środowiska serwera (`C:\ProgramData\ResInvestERP\server.env`), nigdy w HTML i w Git.

### Frontend (app/src)
* Trasy: `#/login`, `#/forgot-password`, `#/reset-password`, `#/invite/accept`, `#/admin/users`, `#/admin/users/:id`, `#/admin/roles`, `#/admin/audit` (w istniejącym routingu).
* Użytkownicy: „Wyślij zaproszenie” (imię, nazwisko, e-mail, rola, magazyn domyślny, dostępne magazyny), akcje: zmień rolę / magazyn, aktywuj, zawieś, dezaktywuj, wyślij ponownie, reset hasła, historia.
* Tryb OFFLINE: bez e-maili (zaproszenia i reset niedostępne — administrator nadaje hasło tymczasowe), wyraźny znacznik „OFFLINE / FIRMOWY”.
* Komunikaty błędów przyjazne (§40); szczegóły w logach serwera.

### Security
* Testy §35: magazynier → endpoint administracyjny 403; zmiana własnej roli 403; manipulacja `warehouse_id` ignorowana/odrzucona; odczyt dokumentu obcego magazynu — brak w danych; usunięcie ostatniego administratora — blokada.

### Tests
* Wszystkie 20 przypadków z §34 jako testy serwera (HTTP + SQLite) i E2E; e-mail przez transport `file` (link z wiadomości użyty w teście). Rzeczywista wysyłka przez Resend — **do weryfikacji po podaniu klucza i DNS** (nie będzie fikcyjnych wyników).

### Documentation
* `docs/AUTHENTICATION.md`, `docs/USERS_AND_ROLES.md`, `docs/EMAIL_SETUP.md` (Resend, DNS: SPF/DKIM/DMARC dla `resinvest.group`), `docs/SECURITY.md`, `.env.example`, README.
* `docs/SUPABASE_SETUP.md` — tylko jeśli zostanie wybrany wariant B.

### Kolejność prac (małe kroki, testy po każdym)
1. K2 izolacja magazynów (bezpieczeństwo — najpierw) · 2. statusy + wiele magazynów + AUDYTOR · 3. e-mail + tokeny + zaproszenia/reset · 4. role/uprawnienia edytowalne · 5. audyt (kody, IP, widok) · 6. dokumentacja, instalator 3.2.0.

---

## 3. Decyzje do akceptacji

1. **Wariant uwierzytelniania:** A — rozszerzyć obecny system (zalecane) · B — Supabase Auth jako dostawca tożsamości (wymaga internetu i projektu Supabase) · C — pełne przejście na React/NestJS/PostgreSQL (przepisanie).
2. **Rejestracja samodzielna:** wyłączyć (tylko zaproszenia, zgodnie ze specyfikacją) czy pozostawić z zatwierdzaniem przez administratora.
3. **Wysyłka e-mail:** Resend (wymaga klucza API i rekordów DNS domeny `resinvest.group`) czy inny serwer SMTP firmy.
4. **Obieg zatwierdzania** (magazynier przekazuje → kierownik zatwierdza) — pozostaje (specyfikacja go nie wymienia, był wymagany wcześniej).

### Decyzje (zaakceptowane 2026-09-25)

| # | Decyzja |
|---|---|
| 1 | **Wariant A** — rozszerzenie obecnego systemu (Node.js + SQLite), bez Supabase i bez przepisywania aplikacji. |
| 2 | **Tylko zaproszenia** — rejestracja samodzielna wyłączona (`allowSelfRegistration: false`, możliwa do włączenia w konfiguracji). |
| 3 | **Resend** — wysyłka przez Resend (HTTP API lub SMTP `smtp.resend.com:465`), nadawca `ResInvest ERP <no-reply@resinvest.group>`. |
| 4 | **Obieg zatwierdzania wyłączony** — magazynier zapisuje operacje bezpośrednio (`requireApproval: false`; mechanizm pozostaje w silniku do ewentualnego włączenia). |

## 4. Status realizacji (3.2.0)

| Konflikt / krok planu | Stan |
|---|---|
| K2 — `/api/state` wysyłał dane wszystkich magazynów | **usunięty**: `Service.project` (odczyt) + `canAccessWh` (zapis); testy §34.13–14, §35.3–4 |
| statusy INVITED / ACTIVE / SUSPENDED / DISABLED | zrobione (migracja 5 → 6, `pending` → `INVITED`) |
| wiele magazynów na użytkownika | zrobione (`warehouseIds`, przełącznik magazynu roboczego) |
| rola AUDYTOR, kody ról, edytowalne uprawnienia | zrobione (`#/admin/roles`, `ROLE_PERMISSIONS_CHANGED`) |
| zaproszenia, potwierdzenie adresu, reset hasła | zrobione (tokeny jednorazowe, `server/mail.mjs`, szablony PL) |
| audyt z kodami, IP, User-Agent + widok | zrobione (`#/admin/audit`, zakładki logowań i wiadomości e-mail) |
| obieg zatwierdzania wyłączony, rejestracja wyłączona | zrobione (konfiguracja w Administracji) |
| dokumentacja, `.env.example`, instalator 3.2.0 | zrobione |
| rzeczywista wysyłka przez Resend | **niezweryfikowana** — wymaga klucza API i zweryfikowanej domeny (docs/EMAIL_SETUP.md) |

Szczegóły: [AUTHENTICATION.md](AUTHENTICATION.md), [USERS_AND_ROLES.md](USERS_AND_ROLES.md), [SECURITY.md](SECURITY.md).

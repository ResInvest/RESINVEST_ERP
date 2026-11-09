# AUTH IMPLEMENTATION REPORT — ResInvest ERP 3.2.0

Data: 2026-09-25 · Wariant: **A** (rozbudowa istniejącego serwera Node.js + SQLite, bez Supabase) ·
Decyzje: tylko zaproszenia, Resend, obieg zatwierdzania wyłączony ([AUTH_AUDIT_PLAN.md](AUTH_AUDIT_PLAN.md)).

## 1. Co zmieniono

* **Krytyczna luka K2 usunięta:** `GET /api/state` (i odpowiedzi komend) wysyłał dane wszystkich magazynów każdemu
  użytkownikowi. Teraz serwer wysyła wyłącznie widok dostępnych magazynów (`Service.project`), a korekty, anulowania
  i zatwierdzenia wymagają dostępu do magazynu operacji (`canAccessWh`).
* Role ADMINISTRATOR / MANAGER / MAGAZYNIER / OBSERWATOR / **AUDYTOR** z kodami, zestawy uprawnień edytowalne przez
  administratora; statusy kont INVITED / ACTIVE / SUSPENDED / DISABLED; magazyn domyślny + dostępne magazyny.
* Logowanie e-mailem z walidacją domeny na serwerze, komunikaty bez szczegółów technicznych.
* Zaproszenia, reset hasła, potwierdzenie zmienionego adresu — tokeny jednorazowe; poczta Resend (API/SMTP) lub `.eml`.
* Rozszerzony (nie nowy) dziennik audytu: kod zdarzenia, adres IP, User-Agent; widok `#/admin/audit`.
* Ekrany: `#/login`, `#/forgot-password`, `#/reset-password`, `#/invite/accept`, `#/confirm-email`, `#/admin/users[/:id]`,
  `#/admin/roles`, `#/admin/permissions`, `#/admin/audit`; menu konta (Moje konto, Zmiana hasła, Magazyn, Wyloguj);
  znacznik trybu OFFLINE / FIRMOWY.
* Uprawnienie `warehouses.edit` egzekwowane (wcześniej magazyny mógł zmieniać Kierownik).
* Samodzielna rejestracja i obieg zatwierdzania domyślnie wyłączone (przełączniki w Administracji).

## 2. Pliki dodane

`server/mail.mjs`, `.env.example`, `app/src/i18n.d12.js`, `tests/auth.test.mjs`, `tests/e2e-server.cjs`,
`docs/AUTHENTICATION.md`, `docs/USERS_AND_ROLES.md`, `docs/EMAIL_SETUP.md`, `docs/SUPABASE_SETUP.md`,
`docs/SECURITY.md`, `docs/AUTH_AUDIT_PLAN.md`, `docs/AUTH_IMPLEMENTATION_REPORT.md`.

## 3. Pliki zmienione

`app/src/engine.js` (uprawnienia, role, statusy, dostęp do magazynów, migracja 5 → 6, moduły Users / Roles / Settings,
walidacja e-mail, audyt z IP/UA), `app/src/service.js` (komendy `roles.*`, `settings.save`, projekcja danych,
`op.commit` wg konfiguracji), `app/src/seed.js`, `app/src/auth.js`, `app/src/core.js`, `app/src/admin.js`,
`app/src/form.js`, `app/src/views.js`, `app/src/dashboard.js`, `app/src/styles.css`, słowniki `i18n.d01–d11.js`
(usunięte nieużywane teksty), `server/core.mjs`, `server/riw-server.mjs`, `tests/*.test.mjs`, `tests/e2e.cjs`,
`installer/ResInvestERP.iss`, `installer/build-installer.ps1`, `package.json`, `.gitignore`, `README.md`, `TASKS.md`, `progress.md`,
`data/sample_data.json`, `ResInvest_ERP.html` (build).

## 4. Migracje

* **Dokument stanu: schemat 5 → 6** (automatycznie przy starcie serwera / otwarciu programu, bez utraty danych):
  `status` z `active`/`pending`, podział `name` → `firstName`/`lastName`, `warehouseIds = [whId]`,
  `config.requireApproval = false`, `config.allowSelfRegistration = false`, `rolePerms = {}`;
  robocze operacje „DO ZATWIERDZENIA” wracają do ROBOCZYCH, gdy obieg jest wyłączony.
* **SQLite (addytywnie, `CREATE TABLE IF NOT EXISTS`):** `tokens` (skrót tokenu, rodzaj, e-mail, ważność, użycie),
  `outbox` (dziennik wysyłek). Brak `DROP`, `TRUNCATE`, usuwania danych.

## 5. Endpointy dodane

`POST /api/auth/forgot`, `POST /api/auth/token`, `POST /api/auth/reset`, `POST /api/auth/confirm`,
`POST /api/invite/accept`, `POST /api/users/invite`, `POST /api/users/resend`, `POST /api/users/reset-link`,
`GET /api/audit/extra`; komendy `/api/cmd`: `roles.save`, `roles.reset`, `settings.save`.
Zmienione: `/api/state` i `/api/cmd` (projekcja danych; odmowa → HTTP 403), `/api/auth/login` (domena, statusy),
`/api/users/accounts` (zaproszenia; podgląd dla `users.read`), `/api/health` (`selfRegistration`).
CLI: `--mail-test <adres>`. Pełna lista: [AUTHENTICATION.md §10](AUTHENTICATION.md).

## 6. Role

ADMINISTRATOR (`admin`), MANAGER (`kierownik`), MAGAZYNIER (`magazynier`), OBSERWATOR (`obserwator`),
**AUDYTOR (`audytor`) — nowa**. Szczegóły i zestawy domyślne: [USERS_AND_ROLES.md](USERS_AND_ROLES.md).

## 7. Uprawnienia

Nowe: `receipts.create`, `issues.create`, `production.create`, `mm.create`, `reports.export`, `history.read`,
`audit.read`, `users.read`, `roles.assign`, `warehouses.edit`, `settings.edit`.
Zachowane: `op.approve`, `documents.cancel`, `documents.correct`, `purchases.correct`, `sales.correct`,
`production.correct`, `inventory.correct`, `inv.open`, `inv.count`, `inv.close`, `fleet.edit`, `master.edit`,
`report.view`, `users.manage`, `data.backup`, `data.import`. (`op.create` = dowolne z czterech uprawnień wprowadzania.)

## 8. Testy wykonane i wyniki (rzeczywiste, 2026-09-25)

| Zestaw | Wynik |
|---|---|
| `npm run check` (składnia wszystkich modułów) | OK |
| `npm run i18n` (1 826 tekstów PL → CS/EN) | 0 braków, 0 błędnych parametrów, 0 nieużywanych |
| `tests/engine.test.mjs` | 68/68 |
| `tests/pdf.test.mjs` | 4/4 |
| `tests/platform.test.mjs` | 29/29 |
| `tests/server.test.mjs` | 9/9 |
| `tests/auth.test.mjs` — §34 (1–20) i §35 (1–5) + błąd wysyłki, dezaktywacja, zmiana adresu, sekrety | 25/25 |
| `tests/e2e.cjs` — Chromium, tryb OFFLINE (desktop, telefon 390 px, role, audyt, magazyny) | 178/178, konsola bez błędów |
| `tests/e2e-server.cjs` — Chromium + serwer: zaproszenie → link → hasło → logowanie, reset hasła, izolacja | 24/24, konsola bez błędów |

Mapowanie §34: 1 logowanie · 2 błędne hasło · 3 konto niepotwierdzone (INVITED; zmiana adresu — test osobny) ·
4 obca domena · 5 zaproszenie · 6 aktywacja (także link zużyty / przeterminowany / fałszywy) · 7 reset hasła ·
8–12 role · 13 właściwy magazyn · 14 obcy magazyn · 15 nadanie sobie ADMINISTRATOR · 16 zmiana roli przez MAGAZYNIERA ·
17 ostatni administrator · 18 brak sesji · 19 wygasła sesja · 20 równoczesna praca (unikalne numery, brak stanu ujemnego).
§35: 1 endpointy administracyjne → 403 · 2 własna rola → 403 · 3 manipulacja `warehouse_id` ignorowana/odrzucona ·
4 dokument obcego magazynu niedostępny · 5 ostatni administrator zablokowany.

Test wykrył i pozwolił poprawić błąd formularza: po zmianie magazynu domyślnego nowej osoby poprzedni domyślny
magazyn administratora pozostawał zaznaczony (nadmiarowy dostęp).

## 9. Konfiguracja ENV

`.env.example` → `server.env` (instalacja: `C:\ProgramData\ResInvestERP\server.env`):
`APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `INVITE_HOURS`, `RESET_HOURS`, `CONFIRM_HOURS`; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY` —
puste, nieużywane (wariant A). Istniejące zmienne `RIW_*` bez zmian (brak konfliktów).

## 10. Czynności wymagane

**Supabase:** brak (nie używany — [SUPABASE_SETUP.md](SUPABASE_SETUP.md)).

**Resend:** założyć konto, dodać i zweryfikować domenę `resinvest.group`, utworzyć klucz *Sending access*,
wpisać go w `server.env`, uruchomić ponownie serwer, wykonać `--mail-test` ([EMAIL_SETUP.md](EMAIL_SETUP.md)).

**DNS (operator domeny `resinvest.group`):** rekordy SPF (TXT/MX domeny zwrotnej), DKIM (TXT) i DMARC (TXT)
dokładnie według panelu Resend. Program nie tworzy rekordów DNS.

**Pozostałe ręczne kroki:**
1. Zbudować instalator na Windows z Inno Setup 7: `powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1`.
2. Zainstalować / zaktualizować serwer (dane i `server.env` nie są nadpisywane; migracja 5 → 6 wykona się sama —
   przed aktualizacją zrób kopię: *Kopia zapasowa bazy teraz*).
3. Ustawić `APP_URL` (adres programu w sieci firmy); poza siecią lokalną — HTTPS.
4. Zalogować się jako `magazyn@resinvest.group`, zaprosić pracowników, sprawdzić przydział magazynów.
5. Ograniczyć prawa do pliku `server.env` (`icacls`, [SECURITY.md](SECURITY.md)).

## 11. Niezweryfikowane (bez dostępu do usług zewnętrznych)

* Rzeczywista wysyłka przez Resend (API i SMTP) i doręczalność (SPF/DKIM/DMARC) — **NIEPOTWIERDZONE**;
  przetestowano przebieg z transportem `file` oraz zachowanie przy błędzie wysyłki (brak klucza).
* Instalator 3.2.0 skompilowany kompilatorem Inno Setup **6.4.1** (Wine) i sprawdzony w Wine 9 (win64): instalacja,
  start serwera, aktualizacja na istniejących danych, deinstalacja. Kompilacja w **Inno Setup 7** i praca na prawdziwym
  Windows — **NIEPOTWIERDZONE** (plik `.iss` w UTF-8 z BOM, skrypt wyszukuje ISCC 7/6).
* „TypeScript przechodzi” — nie dotyczy: projekt jest w JavaScript (ES2020, bez kroku kompilacji TypeScript).

# GenResInvest 1.0 — architektura

## 1. Architektura systemu

```
┌──────────────────────── Przeglądarka (komputer / telefon / tablet) ────────────────────────┐
│  SPA (vanilla JS, moduły ES, bez kroku budowania)                                           │
│  app.js (router #/…, sesja, menu) · views/* (ekrany) · combobox.js · ui.js · api.js         │
└───────────────────────────────▲─────────────────────────────────────────────────────────────┘
                                │ HTTPS/HTTP JSON  (ciasteczko HttpOnly + nagłówek X-GRI-Request)
┌───────────────────────────────┴──── Serwer GenResInvest (1 proces, Windows/Linux) ──────────┐
│  FastAPI ─ api/  (auth, contractors, dictionaries, orders, reports, admin)                  │
│     │         walidacja Pydantic → komunikaty PL z nazwą pola → fokus w UI                  │
│  services/ (logika biznesowa — niezależna od HTTP)                                         │
│     orders.py      cykl życia zlecenia, migawki, korekty, słowniki „dopisz, gdy brak”       │
│     numbering.py   numer bez luk przy wystawieniu (licznik per miesiąc/rok)                │
│     documents/     content.py (jeden model treści) → pdf_renderer.py / docx_renderer.py     │
│                    store.py (archiwum plików + SHA-256, zapis atomowy)                      │
│     reports.py · importexport.py · backup.py (kopie + harmonogram) · settings_store.py     │
│  audit.py (dziennik zdarzeń w tej samej transakcji) · security.py (hasła, sesje, role)      │
│  db.py — SQLAlchemy 2.0, SQLite WAL + synchronous=FULL, migracje wersjonowane               │
└──────────────┬───────────────────────────────┬──────────────────────────────┬──────────────┘
         genresinvest.db               documents/RRRR/MM/*.pdf|docx        backups/*.zip
```

**Decyzje projektowe**

| Decyzja | Uzasadnienie |
|---|---|
| Aplikacja webowa uruchamiana lokalnie (serwer + przeglądarka) | Jeden instalator Windows, a jednocześnie dostęp z telefonów i innych komputerów w sieci firmy (wieloużytkowość). |
| SQLite (WAL) zamiast serwera bazy | Zero administracji; WAL + `synchronous=FULL` = odporność na awarię zasilania. Kod nie zależy od SQLite (poza PRAGMA) — przejście na PostgreSQL to zmiana URL + `SELECT … FOR UPDATE` w numeracji. |
| Kwoty w groszach (`int`) | Brak błędów zaokrągleń float. |
| Migawki danych w zleceniu | Zmiana kartoteki kontrahenta lub danych firmy nie zmienia wystawionych dokumentów. |
| DOCX na oryginalnym `Papier_firmowy_ResInvest.docx` | Nagłówek, stopka i numeracja stron 1:1 z firmowego wzoru. |
| PDF natywnie (reportlab + Liberation Sans) | Działa offline, bez MS Word/LibreOffice; ten sam wynik na każdym komputerze. |
| Jeden model treści (`content.py`) | PDF i DOCX mają identyczną treść; zmiana układu w jednym miejscu. |
| Vanilla JS bez bundlera | Brak łańcucha narzędzi Node w instalatorze; kod czytelny i łatwy w utrzymaniu przez lata. |
| Blokada optymistyczna (`row_version`) | Dwie osoby edytujące to samo zlecenie nie nadpiszą sobie zmian (HTTP 409). |

### Cykl życia zlecenia

```
 szkic (draft) ──Wystaw──▶ wystawione (issued, rewizja 1, numer ZL/001/11/2026)
   │  edycja dowolna           │ ──Korekta + powód──▶ wystawione (rewizja 2, 3…)  [archiwum: każda rewizja osobno]
   │  podgląd „PROJEKT”        └──Anuluj + powód──▶ anulowane (PDF z oznaczeniem ANULOWANE)
   └──Usuń (tylko szkic)
```

## 2. Struktura plików

```
genresinvest/
├── run.py                      punkt startowy (dev i .exe), opcje CLI
├── requirements.txt / -dev.txt zależności
├── .env.example                konfiguracja środowiska
├── pyproject.toml              konfiguracja pytest
├── start-genresinvest.cmd      start deweloperski na Windows
├── app/
│   ├── __init__.py             wersja programu i schematu
│   ├── config.py               ustawienia (.env, GRI_*), ścieżki danych
│   ├── db.py                   silnik, sesje, migracje, blokada zapisu
│   ├── models.py               model danych (ORM)
│   ├── schemas.py              schematy API + walidacja
│   ├── validators.py           NIP, kody, telefony, kwoty (grosze)
│   ├── security.py             PBKDF2, sesje, CSRF, role
│   ├── audit.py                dziennik zdarzeń
│   ├── errors.py               jednolite błędy {detail, errors[field]}
│   ├── main.py                 fabryka FastAPI, nagłówki bezpieczeństwa
│   ├── api/                    auth, contractors, dictionaries, orders, reports, admin
│   ├── services/               orders, numbering, reports, importexport, backup, seed, settings_store
│   │   └── documents/          content, pdf_renderer, docx_renderer, store
│   ├── assets/                 letterhead.docx, header.jpg, fonts/
│   └── static/                 index.html, css/app.css, js/(app, api, ui, combobox, views/*)
├── sample_data/                dane startowe (JSON) + przykładowy CSV kontrahentów
├── tests/                      testy jednostkowe i API (pytest)
├── installer/                  GenResInvest.spec (PyInstaller), GenResInvest.iss (Inno Setup), build.ps1
└── docs/ARCHITEKTURA.md
```

## 3. Schemat bazy danych

```
users ─────────┐            contractors ◀──────────── orders ──────────▶ order_items
 id PK         │             id PK                      id PK                id PK
 username UQ   │             name, street,              number UQ (null=szkic) order_id FK (CASCADE)
 full_name     │             postal_code, city,         period_key, seq UQ(period,seq) position
 role          │             country, nip UQ            status draft|issued|cancelled  route
 password_hash │             phone, email,              revision, row_version  net_amount_gr
 must_change_pw│             contact_person, notes      issue_date, issue_place quantity_milli
 failed_logins │             is_active, row_version     contractor_id FK (RESTRICT)
 locked_until  │                                        contractor_snapshot JSON
               │            service_templates           issuer_snapshot JSON
user_sessions  │             short_description UQ       service_short/_detailed, cargo_type
 token_hash UQ │             detailed_description       origin_point, destination_point
 user_id FK ───┘             cargo_type, usage_count    loading_term, payment_days
 expires_at                                             handler_id FK → handlers, handler_name/_phone
                            price_templates             notes, total_net_gr, currency
audit_log                    route, net_amount_gr,      issued_at/_by, cancelled_at/_by, cancel_reason
 ts, user_id, username       unit  UQ(route,amount,unit)
 action, entity, entity_id                              order_revisions                documents
 summary, details JSON, ip  handlers                     order_id FK, revision,         order_id FK, revision,
                             full_name, phone           kind issue|correction|cancel    format pdf|docx
settings (key PK, value JSON) UQ(full_name, phone)       reason, snapshot JSON          relative_path, sha256
number_counters (period_key PK, last_seq)                                               UQ(order,revision,format)
schema_version (version PK)
```

Indeksy: `orders(issue_date)`, `orders(status)`, `audit_log(ts)`, `audit_log(entity, entity_id)`, `contractors(name)`, `price_templates(route)`.

## 4. Punkty końcowe API (`/api/v1`, dokumentacja interaktywna: `/api/docs`)

| Metoda | Ścieżka | Rola | Opis |
|---|---|---|---|
| POST | `/auth/login` · `/auth/logout` · `/auth/change-password` | — / zalogowany | sesja, zmiana hasła |
| GET | `/auth/me` | zalogowany | bieżący użytkownik |
| GET | `/contractors?q=&active=&page=` | podgląd | lista kontrahentów |
| POST/PUT/DELETE | `/contractors`, `/contractors/{id}` | użytkownik | CRUD (usunięcie użytego = dezaktywacja) |
| GET / POST | `/contractors/export.csv` · `/contractors/import?dry_run=` | podgląd / użytkownik | CSV |
| GET/POST/PUT/DELETE | `/services`, `/prices`, `/handlers` (+ `/{id}`) | podgląd / użytkownik | słowniki |
| GET | `/units` | podgląd | jednostki cen |
| GET | `/orders?q=&status=&contractor_id=&date_from=&date_to=&sort=&page=` | podgląd | rejestr |
| POST | `/orders` | użytkownik | nowy szkic |
| GET/PUT/DELETE | `/orders/{id}` | podgląd / użytkownik | odczyt, edycja szkicu lub korekta (`correction_reason`), usunięcie szkicu |
| POST | `/orders/{id}/issue` · `/cancel` · `/duplicate` | użytkownik | wystawienie (numer), anulowanie, duplikat |
| POST | `/orders/preview?format=pdf\|docx` | podgląd | podgląd z danych formularza (bez zapisu) |
| GET | `/orders/{id}/document?format=pdf\|docx` | podgląd | dokument bieżącej rewizji (archiwizowany) |
| GET | `/orders/{id}/revisions` · `/documents` | podgląd | historia rewizji, archiwum plików |
| GET | `/orders/documents/{doc_id}/download` | podgląd | plik archiwalny (weryfikacja SHA-256) |
| GET | `/reports/dashboard` · `/yearly?year=` · `/contractors` · `/routes` | podgląd | raporty |
| GET | `/reports/export?format=xlsx\|csv&…filtry` | podgląd | eksport rejestru |
| GET | `/audit?date_from=&date_to=&username=&entity=&action=&q=` | podgląd | historia operacji |
| GET / PUT | `/settings` | podgląd / admin | dane firmy, numeracja, wartości domyślne, treść dokumentu |
| GET/POST/PUT | `/users`, `/users/{id}`, `/users/{id}/reset-password` | admin | konta |
| GET/POST | `/backups`, `/backups/{name}/download`, `/backups/{name}/restore`, `/backups/upload-restore` | admin | kopie zapasowe |
| GET/POST | `/data/export.json` · `/data/import.json` | admin | kartoteki JSON |
| GET | `/system/info`, `/api/health` | podgląd / — | informacje, monitoring |

Format błędu: `{"detail": "komunikat", "errors": [{"field": "items.0.net_amount", "message": "Kwota musi być większa od zera"}]}` — 401 brak sesji, 403 brak uprawnień, 404, 409 konflikt (zmiana przez innego użytkownika / duplikat), 422 walidacja, 423 konto zablokowane.

## 5. Architektura interfejsu

* **Powłoka** (`app.js`): logowanie i wymuszona zmiana hasła startowego, boczne menu (na telefonie wysuwane), router `#/…`, ochrona przed utratą niezapisanych zmian, skróty `Alt+N/Z/K/R`.
* **Widoki** (`views/`): pulpit, rejestr zleceń, formularz zlecenia (nowe / szkic / korekta), szczegóły zlecenia, kontrahenci, słowniki, raporty, historia, administracja, moje konto.
* **Komponenty** (`ui.js`, `combobox.js`): budowanie DOM bez `innerHTML` (ochrona XSS), pola z etykietami i komunikatami ARIA, okna modalne `<dialog>` z zarządzaniem fokusem, powiadomienia, combobox ARIA z wyszukiwaniem i opcją „+ Dodaj …”.
* **Formularz zlecenia**: 5 sekcji odpowiadających układowi dokumentu; walidacja lokalna (lustro walidacji serwera) i serwerowa — komunikat przy polu + fokus na pierwszym błędzie; poprawienie pola od razu kasuje błąd; `Enter` → następne pole, `Ctrl+S` zapis, `Ctrl+P` podgląd; wyliczanie wartości pozycji na żywo.
* **Responsywność**: siatka 12-kolumnowa → 1 kolumna < 720 px; tabele zamieniają się w karty; pasek akcji przyklejony u dołu; tryb ciemny wg systemu.

## 6. Skalowanie i rozbudowa

* Więcej użytkowników / kilka oddziałów: PostgreSQL (zmiana URL w `db.py`) + kilku workerów; numeracja przez `SELECT … FOR UPDATE` na `number_counters`.
* Nowe typy dokumentów (np. zlecenie spedycyjne, potwierdzenie załadunku): nowy `build_content_*` + ten sam renderer.
* Integracja z ResInvest ERP: REST API i eksport JSON kartotek są gotowe do wymiany danych.
* Nowe pola: migracja nr 2 w `db.MIGRATIONS` (ALTER TABLE) — wydanych migracji nie zmieniamy.

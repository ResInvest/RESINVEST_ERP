# Bezpieczeństwo — ResInvest ERP 3.2

## 1. Zasady

* **Serwer jest jedynym źródłem prawdy** o użytkowniku, roli, uprawnieniach i magazynie. Tożsamość pochodzi
  wyłącznie z sesji; pola `user`, `userId`, `role`, `permissions`, `whId`/`warehouse_id` w żądaniu są ignorowane.
* Uprawnienia sprawdzane w warstwie usług i ponownie w silniku przy każdej komendzie; odmowa → HTTP 403.
* Przeglądarka nie przechowuje roli, uprawnień ani magazynu jako źródła prawdy (w `localStorage` są tylko
  preferencje: język, motyw, ostatni e-mail logowania; w trybie OFFLINE także dane lokalne).
* Sekrety (klucz Resend) czyta tylko serwer — nie ma ich w `ResInvest_ERP.html`, w odpowiedziach API ani w repozytorium.

## 2. Zabezpieczenia (lista kontrolna)

| Wymaganie | Realizacja | Test |
|---|---|---|
| HTTPS w produkcji | `tls.cert`/`tls.key` lub reverse proxy; ciasteczko `Secure` przy TLS | ręcznie |
| bezpieczne sesje | token 256 bit, w bazie skrót, HttpOnly, SameSite=Strict, bezczynność 30 min, maks. 12 h | `server.test` · §34.18–19 |
| brak haseł w danych aplikacji | skróty scrypt w tabeli `accounts`, poza stanem i kopiami JSON | `auth.test` „Sekrety” |
| rate limiting logowania | blokada konta 5/15 min + limit IP 40/15 min | `server.test` |
| rate limiting resetu hasła | 10/h z IP, 3/h na adres; ta sama odpowiedź dla każdego adresu | §34.7 |
| walidacja danych wejściowych | walidatory silnika (`Users.validate`, `planOperation`…), limity rozmiaru żądań | `engine/platform.test` |
| ochrona endpointów | sesja + uprawnienie dla każdej ścieżki `/api/*` poza publicznymi | §35.1 |
| IDOR / obce magazyny | projekcja odczytu (`Service.project`), `canAccessWh` przy korekcie/anulowaniu/zatwierdzeniu | §34.13–14, §35.4 |
| eskalacja uprawnień | brak zmiany własnej roli; rolę ADMINISTRATOR nadaje tylko administrator; ochrona ostatniego administratora | §34.15–17, §35.2, §35.5 |
| manipulacja `warehouse_id` | magazyn z profilu; `me.warehouse` tylko na magazyn dostępny | §35.3 |
| CSRF | nagłówek `X-RIW` + zgodność `Origin` | `server.test` |
| XSS / clickjacking | CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, escapowanie w szablonach | nagłówki: `server.test` |
| tokeny e-mail | 256 bit, skrót SHA-256, jednorazowe, 72 h / 1 h / 48 h, usuwane z adresu strony | §34.5–7 |
| podmiana linku (Host header) | linki tylko z `APP_URL` lub adresu ustalonego przez serwer | przegląd kodu |
| audit log | `state.audit` z kodem, IP, User-Agent; dziennik zmian append-only z łańcuchem SHA-256 | §34.5, `--check` |
| błędy bez szczegółów technicznych | komunikaty ogólne dla użytkownika, szczegóły w `logs/` | §41 test |

## 3. Sekrety i repozytorium

* `.gitignore`: `.env`, `server.env`, `config/server.env`, `data-server/`, `mail-outbox/`.
* W repozytorium jest tylko `.env.example` (puste wartości).
* Na komputerze z wieloma kontami Windows ogranicz prawa do `C:\ProgramData\ResInvestERP\server.env`
  (polecenie `icacls` — [EMAIL_SETUP.md](EMAIL_SETUP.md)).
* Klucz Resend twórz z uprawnieniem *Sending access* i ograniczeniem do domeny; po wycieku — unieważnij w panelu Resend.

## 4. Dane i kopie

* Każda zmiana: jedna transakcja SQLite (stan + wpis dziennika), WAL, `synchronous=FULL`.
* Kopie `VACUUM INTO` przy starcie i codziennie (30 dni), ręcznie z menu Start / Administracji;
  `--check` weryfikuje sumę kontrolną stanu i łańcuch dziennika.
* Konta i magazyny z historią nie są usuwane fizycznie — dezaktywacja.
* Program nie wykonuje `DROP`/`TRUNCATE`; migracje schematu są addytywne (`CREATE TABLE IF NOT EXISTS`, migracja
  dokumentu stanu 5 → 6 bez utraty danych).

## 5. Tryb OFFLINE — ograniczenia

Dane i skróty haseł (PBKDF2) są w przeglądarce użytkownika Windows; osoba z dostępem do tego konta systemu może
je odczytać narzędziami przeglądarki. Tryb OFFLINE służy do szkolenia i pokazu. Dane firmy — tylko tryb FIRMOWY.

## 6. Zgłaszanie problemów

Podejrzenie naruszenia: zatrzymaj serwer, wykonaj kopię (`--backup-now`), sprawdź `--check`, dziennik
logowań i dziennik audytu (filtr po adresie IP / użytkowniku), zmień hasła administratorów i klucz Resend.

# Uwierzytelnianie — ResInvest ERP 3.2

Dokument opisuje logowanie, sesje, zaproszenia, reset hasła i potwierdzanie adresu e-mail.
Role, uprawnienia i dostęp do magazynów opisuje [USERS_AND_ROLES.md](USERS_AND_ROLES.md),
konfigurację poczty — [EMAIL_SETUP.md](EMAIL_SETUP.md), zabezpieczenia — [SECURITY.md](SECURITY.md).

## 1. Architektura (wariant A)

Wymagania zakładały Supabase Auth + NestJS. Po audycie wybrano **wariant A**: rozbudowę istniejącego
serwera ResInvest ERP (Node.js ≥ 22.13 + SQLite) bez zewnętrznej usługi uwierzytelniania.
Uzasadnienie i mapowanie wymagań: [AUTH_AUDIT_PLAN.md](AUTH_AUDIT_PLAN.md), [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

| Element | Realizacja |
|---|---|
| Konta i hasła | tabela `accounts` (SQLite): skrót **scrypt** (N=2^15, r=8, p=1, sól 16 B); hasło nigdy nie trafia do danych aplikacji ani do kopii JSON |
| Profil, rola, magazyny, status | dokument stanu (`state.users`), zmieniany wyłącznie komendą `user.save` po stronie serwera |
| Sesja | losowy token 256 bit w ciasteczku `riw_sid` (HttpOnly, SameSite=Strict, Secure przy HTTPS); w bazie tylko skrót SHA-256 |
| Tokeny e-mail | tabela `tokens`: losowe 256 bit, w bazie tylko skrót SHA-256, jednorazowe, z terminem ważności |
| Wysyłka e-mail | `server/mail.mjs`: Resend (API HTTPS), SMTP (TLS) albo zapis `.eml` (transport `file`) |
| Kolejka wysyłek | tabela `outbox`: szablon, adresat, wynik, błąd — bez treści linków |
| Audyt | istniejący dziennik `state.audit` rozszerzony o `code`, `ip`, `ua` (jeden system historii) |

## 2. Tryby pracy

| Tryb | Opis | Logowanie | Poczta |
|---|---|---|---|
| **FIRMOWY** | ResInvest ERP Serwer — wiele stanowisk | serwer (scrypt, sesja HttpOnly) | zaproszenia, reset hasła, potwierdzenie adresu |
| **OFFLINE** | plik `ResInvest_ERP.html` bez serwera — jedno stanowisko, szkolenie | w przeglądarce (PBKDF2-SHA256, 120 000 iteracji) | brak — administrator ustawia hasło tymczasowe |

Tryb jest widoczny na ekranie logowania, w stopce menu i w *Mój profil* (znacznik **FIRMOWY** / **OFFLINE**).
W trybie OFFLINE dane są w przeglądarce użytkownika — to tryb do nauki i pokazu, nie do pracy wielu osób.

## 3. Logowanie

Ekran `#/login`: **E-mail służbowy**, **Hasło** (z przyciskiem „pokaż”), **Zaloguj się**, **Nie pamiętam hasła**.

1. Przeglądarka sprawdza format i domenę (wygoda); **serwer sprawdza ponownie** (`validateCompanyEmail`):
   adres jest normalizowany (`normalizeEmail`: bez spacji, małe litery), domena musi być dokładnie jedną z
   `companyDomains` (`config/app.config.json`, domyślnie `resinvest.group`) — `@resinvest.group.pl`,
   `@sub.resinvest.group`, `@evil-resinvest.group` są odrzucane.
2. Weryfikacja hasła w stałym czasie; dla nieistniejącego konta wykonywany jest pozorny skrót (bez różnicy czasu odpowiedzi).
3. Status konta: tylko **ACTIVE** może się zalogować; adres po zmianie musi być potwierdzony.
4. Serwer tworzy sesję, a przeglądarka pobiera profil, rolę, uprawnienia i **widok danych ograniczony do
   dostępnych magazynów** (`GET /api/state`).

Komunikaty (bez szczegółów technicznych — te trafiają do dziennika serwera):

| Sytuacja | Komunikat |
|---|---|
| złe hasło / nieznane konto | Nieprawidłowy e-mail lub hasło. |
| konto INVITED (zaproszenie nieprzyjęte) | Twoje konto nie zostało jeszcze aktywowane. |
| konto SUSPENDED / DISABLED | Twoje konto jest nieaktywne. |
| brak uprawnienia do komendy | Nie masz uprawnień do wykonania tej operacji. |
| adres spoza domeny | Wymagany e-mail firmowy (@resinvest.group) |
| 5 błędnych haseł | Konto zablokowane … Spróbuj za N min albo poproś administratora o odblokowanie. |

Limity: blokada konta po `security.maxFailed` (5) błędnych hasłach na `lockMinutes` (15);
limit prób z jednego adresu IP `ipAttemptsPer15Min` (40 / 15 min) — dotyczy logowania, rejestracji i linków e-mail.
Każda próba trafia do dziennika logowań (`login_log`: czas, e-mail, wynik, przyczyna, adres IP).

## 4. Sesja i wylogowanie

* wylogowanie po `session.idleMinutes` (30) bezczynności i najpóźniej po `absoluteHours` (12);
* zmiana hasła, reset hasła, dezaktywacja, zawieszenie i zmiana adresu e-mail **kończą sesje** użytkownika na innych stanowiskach;
* **Wyloguj** unieważnia sesję na serwerze, czyści stan użytkownika i pamięć formularzy w przeglądarce i przechodzi do `#/login`;
* ochrona CSRF: nagłówek `X-RIW: 1` + zgodność nagłówka `Origin` dla każdego żądania zmieniającego dane.

## 5. Zaproszenie (jedyny domyślny sposób dodania pracownika)

```
Administrator → Użytkownicy → Dodaj użytkownika → imię, nazwisko, e-mail @resinvest.group, rola,
magazyn domyślny, dostępne magazyny → Wyślij zaproszenie
  → konto INVITED, wpisy audytu USER_INVITED + INVITE_SENT
  → e-mail „Zaproszenie do ResInvest ERP” z linkiem  APP_URL/#/invite/accept?token=…  (ważny 72 h, jednorazowy)
  → pracownik ustawia hasło (polityka haseł) → konto ACTIVE, adres potwierdzony, audyt USER_ACTIVATED
  → logowanie
```

* Ponowne wysłanie (**Wyślij ponownie zaproszenie**) tworzy nowy link — poprzedni traci ważność; konto nie jest duplikowane.
* Błąd wysyłki: konto **pozostaje INVITED**, administrator widzi komunikat, audyt `INVITE_EMAIL_FAILED`,
  szczegóły techniczne w dzienniku serwera; można wysłać ponownie.
* Link po otwarciu jest usuwany z paska adresu i historii przeglądarki (token zostaje tylko w pamięci strony).
* Alternatywa (np. brak poczty): **Ustaw hasło tymczasowe** — konto ACTIVE, zmiana hasła przy pierwszym logowaniu.
* Samodzielna rejestracja z ekranu logowania jest **wyłączona** (`config.allowSelfRegistration = false`).
  Po włączeniu (Administracja → Konfiguracja dostępu) zgłoszenie ma status INVITED i czeka na nadanie roli przez administratora.

## 6. Reset hasła

* **Nie pamiętam hasła** (`#/forgot-password`): e-mail służbowy → zawsze ta sama odpowiedź
  („Jeśli konto z tym adresem istnieje i jest aktywne, wysłaliśmy wiadomość…”) — bez ujawniania, czy konto istnieje.
  Limity: 10 próśb / h z adresu IP, 3 wiadomości / h na adres e-mail. Audyt `PASSWORD_RESET_REQUESTED`.
* Link `#/reset-password?token=…` ważny **1 h**, jednorazowy → nowe hasło → wszystkie sesje wylogowane,
  odblokowanie konta, audyt `PASSWORD_RESET_COMPLETED`, e-mail „Hasło zostało zmienione”.
* Administrator może wysłać link resetu z listy użytkowników (hasła nie zna) albo ustawić hasło tymczasowe
  (audyt `PASSWORD_SET_BY_ADMIN`).
* Konsola serwera (awaryjnie, serwer zatrzymany): `node server/riw-server.mjs --reset-password <e-mail>`.

## 7. Zmiana i potwierdzenie adresu e-mail

Zmiana adresu przez administratora: audyt `EMAIL_CHANGED`, sesje użytkownika kończone, na **nowy** adres idzie
„Potwierdź adres e-mail” (link `#/confirm-email?token=…`, 48 h), na **stary** — powiadomienie o zmianie.
Do potwierdzenia logowanie jest zablokowane (komunikat o niepotwierdzonym adresie). Potwierdzenie: audyt `EMAIL_CONFIRMED`.

## 8. Polityka haseł

Min. 8 znaków, litery i cyfry, bez części loginu (przed „@”), maks. 128 znaków — ta sama reguła w przeglądarce
i na serwerze (`app/src/auth.js → passwordError`). Hasła nie są zapisywane w kodzie; jedyne stałe hasło
`demo1234` dotyczy **wyłącznie kont danych przykładowych** (szkolenie) i wymaga zmiany przy pierwszym logowaniu na serwerze.

## 9. Adresy (routing)

| Adres | Ekran | Dostęp |
|---|---|---|
| `#/login` | logowanie | publiczny |
| `#/forgot-password` | nie pamiętam hasła | publiczny |
| `#/reset-password?token=` | nowe hasło z linku | publiczny (token) |
| `#/invite/accept?token=` | aktywacja zaproszenia | publiczny (token) |
| `#/confirm-email?token=` | potwierdzenie adresu | publiczny (token) |
| `#/admin/users`, `#/admin/users/:id` | użytkownicy / karta użytkownika | `users.read` (zmiany: `users.manage`) |
| `#/admin/roles`, `#/admin/permissions` | role i macierz uprawnień | `users.read` (zmiany: `roles.assign`) |
| `#/admin/audit` | dziennik audytu, logowania, wiadomości e-mail | `audit.read` |

Aliasy w menu: *Użytkownicy* (`#/uzytkownicy`), *Role i uprawnienia* (`#/role`), *Dziennik audytu* (`#/audyt`).
Ukrycie pozycji menu jest tylko wygodą — każde żądanie jest sprawdzane na serwerze.

## 10. API (serwer)

| Metoda i ścieżka | Opis | Wymaga |
|---|---|---|
| `POST /api/auth/login` | logowanie `{login, password}` | — |
| `POST /api/auth/logout` | wylogowanie | sesja |
| `GET /api/auth/me` | bieżący użytkownik | sesja |
| `POST /api/auth/password` | zmiana własnego hasła `{old, new}` | sesja |
| `POST /api/auth/forgot` | prośba o reset `{email}` | — (limit) |
| `POST /api/auth/token` | sprawdzenie linku `{kind: invite\|reset\|confirm, token}` | — (limit) |
| `POST /api/invite/accept` | aktywacja zaproszenia `{token, password, password2}` | token |
| `POST /api/auth/reset` | nowe hasło z linku `{token, password, password2}` | token |
| `POST /api/auth/confirm` | potwierdzenie adresu `{token}` | token |
| `POST /api/auth/register` | rejestracja samodzielna (tylko gdy włączona) | — |
| `GET /api/state` | widok danych użytkownika (izolacja magazynów) | sesja |
| `POST /api/cmd` | komenda usługi `{cmd, args}`; odmowa uprawnień → HTTP 403 | sesja |
| `POST /api/users/invite` | dodanie użytkownika zaproszeniem `{rec}` | `users.manage` |
| `POST /api/users` | dodanie użytkownika z hasłem tymczasowym `{rec, password}` | `users.manage` |
| `POST /api/users/resend` | ponowne zaproszenie / potwierdzenie `{userId}` | `users.manage` |
| `POST /api/users/reset-link` | link resetu hasła `{userId}` | `users.manage` |
| `POST /api/users/password` | hasło tymczasowe `{userId, password, mustChange}` | `users.manage` |
| `POST /api/users/unlock` | odblokowanie konta `{userId}` | `users.manage` |
| `GET /api/users/accounts` | stan haseł, zaproszeń, ostatnie logowanie | `users.read` (zakres) / `users.manage` |
| `GET /api/audit/extra` (`/api/auth/log`) | dziennik logowań i wysyłek e-mail | `audit.read` lub `users.manage` |

Zmiany ról, statusów, magazynów, uprawnień ról i konfiguracji — komendy `/api/cmd`:
`user.save`, `user.remove`, `roles.save`, `roles.reset`, `settings.save`, `me.warehouse`.

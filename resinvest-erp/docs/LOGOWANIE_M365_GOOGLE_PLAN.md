# Plan: logowanie kontem Microsoft 365 (i Google) w ResInvest ERP Serwer

Stan na 03.11.2026 · dotyczy ResInvest ERP 3.12 (serwer Node.js + SQLite) i kierunku dla 4.0.

## 1. Gdzie jesteśmy

| Element | Dziś (3.12) |
|---|---|
| Logowanie | własne konta serwera: e-mail + hasło (scrypt), sesja w ciasteczku `riw_sid` (HttpOnly, SameSite=Strict), blokada po 5 błędach, limity IP — [AUTHENTICATION.md](AUTHENTICATION.md) |
| Domeny kont | `COMPANY_DOMAINS` w `server.env` (wariant instalacji: `resinvest.group` / Gmail / `*` = dowolna) |
| Poczta | `EMAIL_TRANSPORT=smtp` (Microsoft 365, Gmail, dowolny SMTP), Resend, AgentMail, plik |
| Better Auth | **nie jest używany** w 3.x. Serwer nie ma zależności npm (przenośny `node.exe` w instalatorze). Biblioteka może zostać rozważona przy pracy nad 4.0 |

## 2. Cel

1. Przycisk **„Zaloguj przez Microsoft 365”** na ekranie logowania — konto służbowe `@resinvest.group` z Entra ID (dawniej Azure AD), z MFA i zasadami dostępu warunkowego firmy.
2. Opcjonalnie **„Zaloguj przez Google”** dla wariantu Gmail.
3. Bez zmian zostają: role, uprawnienia, izolacja magazynów, dziennik audytu i sesja serwera. Logowanie zewnętrzne tylko **potwierdza tożsamość**. O dostępie nadal decyduje ResInvest ERP.

## 3. Decyzja techniczna

| Wariant | Opis | Za | Przeciw |
|---|---|---|---|
| **A. OIDC we własnym serwerze (zalecany dla 3.x)** | Authorization Code + PKCE do Entra ID / Google, weryfikacja `id_token` (RS256, JWKS) przez `node:crypto` | zero nowych zależności, ten sam instalator i ta sama sesja, pełna kontrola audytu | ok. 400–600 wierszy kodu i testów do utrzymania |
| B. Better Auth w serwerze 3.x | biblioteka TS (`socialProviders.microsoft / google`) | gotowe dostawcy, mniej kodu OIDC | zależności npm w przenośnym instalatorze, własne tabele i sesje — równoległe do istniejących kont, migracja kont, ryzyko dwóch systemów sesji |
| **C. Better Auth w 4.0 (zalecany kierunek dla 4.0)** | NestJS + PostgreSQL, Better Auth jako warstwa tożsamości z dostawcami Microsoft i Google | standard dla nowej architektury, wsparcie MCP Better Auth | wymaga przełączenia na 4.0 |

**Rekomendacja:** w 3.x wariant A. W 4.0 Better Auth (C) z tymi samymi zasadami łączenia kont, żeby przejście było przezroczyste dla pracowników.

## 4. Przebieg logowania (wariant A)

```
Przeglądarka ──► GET /api/auth/oidc/microsoft/start
                   serwer: state + nonce + code_verifier (PKCE) → tabela oidc_flows (5 min, jednorazowe)
              ◄── 302 → https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/authorize
                        ?client_id&response_type=code&scope=openid email profile&redirect_uri&state&nonce&code_challenge(S256)
Entra ID: logowanie, MFA, dostęp warunkowy
              ◄── 302 → APP_URL/api/auth/oidc/microsoft/callback?code&state
serwer: wymiana kodu na tokeny (POST /token z code_verifier i client_secret)
        weryfikacja id_token: podpis RS256 (JWKS z cache), iss = https://login.microsoftonline.com/<TENANT>/v2.0,
        aud = CLIENT_ID, exp/nbf, nonce, tid = TENANT (tylko tenant firmy)
        adres: claim email (albo preferred_username) → normalizeEmail → COMPANY_DOMAINS
        konto: istniejące konto ACTIVE z tym adresem; przy pierwszym logowaniu powiązanie oid ↔ użytkownik
        → ta sama sesja riw_sid co dziś → 302 APP_URL/#/pulpit
```

Zasady:

- **Bez samodzielnego zakładania kont.** Konto zakłada administrator zaproszeniem, jak dziś. Logowanie Microsoft aktywuje konto INVITED tylko wtedy, gdy adres się zgadza.
- **Powiązanie po `oid` + `tid`**, nie tylko po adresie e-mail. Zmiana adresu w M365 nie zabiera dostępu, a cudzy tenant z tym samym adresem nie przejmie konta.
- Hasło lokalne zostaje jako awaryjne. Administrator może je wyłączyć dla wybranych osób albo dla całej firmy: `AUTH_PASSWORD_LOGIN=false` (dla administratora — zawsze awaryjnie z konsoli serwera).
- Każde zdarzenie trafia do dziennika audytu: `SSO_LOGIN_SUCCESS`, `SSO_LOGIN_FAILED` (przyczyna: tenant, domena, konto nieaktywne, brak konta), `SSO_LINKED`, `SSO_UNLINKED`.

## 5. Konfiguracja Microsoft 365 (administrator firmy)

1. **Entra ID → Rejestracje aplikacji → Nowa rejestracja:** „ResInvest ERP”, konta tylko w tym katalogu (single tenant).
2. **Identyfikator URI przekierowania (Web):** `https://erp.resinvest.group/api/auth/oidc/microsoft/callback`.
   **Uwaga:** Microsoft dopuszcza `http://` tylko dla `localhost`. Serwer w sieci firmowej potrzebuje więc HTTPS: certyfikat w `config/server.config.json → tls` albo odwrotne proxy (np. IIS, nginx) z nazwą `erp.resinvest.group`.
3. **Certyfikaty i wpisy tajne:** nowy klucz tajny klienta. Ważność 12–24 mies.; termin wymiany przypisz do zadania.
4. **Uprawnienia API:** `openid`, `email`, `profile` (Microsoft Graph, delegowane) — zgoda administratora.
5. W `C:\ProgramData\ResInvestERP\server.env`:

```
APP_URL=https://erp.resinvest.group
AUTH_MICROSOFT_TENANT_ID=<identyfikator katalogu>
AUTH_MICROSOFT_CLIENT_ID=<identyfikator aplikacji>
AUTH_MICROSOFT_CLIENT_SECRET=<wpis tajny>
# opcjonalnie: tylko członkowie grupy Entra (claim groups) — np. „ResInvest ERP — użytkownicy”
AUTH_MICROSOFT_GROUP_ID=
```

6. **Dostęp warunkowy (zalecane):** MFA dla aplikacji „ResInvest ERP”, logowanie tylko z urządzeń firmowych albo z sieci firmy / VPN (FortiClient).

## 6. Poczta Microsoft 365 a koniec SMTP AUTH z hasłem

Wariant instalacji „Firma” wysyła pocztę przez `smtp.office365.com:587` (STARTTLS) z hasłem skrzynki `magazyn@resinvest.group`.
Microsoft zmienił harmonogram wycofania hasła w SMTP AUTH (komunikat MC786329, aktualizacja 27.01.2026). Do grudnia 2026 bez zmian. Od końca grudnia 2026 SMTP AUTH z hasłem będzie **domyślnie wyłączone** w istniejących tenantach, a administrator może je jeszcze włączyć. Ostateczną datę usunięcia Microsoft ma ogłosić w drugiej połowie 2027.

Plan na tę zmianę:

| Krok | Opis |
|---|---|
| Teraz | `EMAIL_TRANSPORT=smtp`, SMTP AUTH włączone dla jednej skrzynki: `Set-CASMailbox magazyn@resinvest.group -SmtpClientAuthenticationDisabled $false` |
| Przed wyłączeniem | **SMTP z OAuth 2.0 (XOAUTH2)**: ta sama rejestracja aplikacji w Entra ID, uprawnienie aplikacji `SMTP.SendAsApp`, przypisanie do skrzynki (`New-ServicePrincipal` + `Add-MailboxPermission`). Serwer pobiera token (client credentials) i loguje się `AUTH XOAUTH2`. Zmiana w `server/mail.mjs`: nowy tryb `SMTP_AUTH=oauth2` + `SMTP_OAUTH_TENANT_ID / CLIENT_ID / CLIENT_SECRET` |
| Alternatywa | Resend albo AgentMail (już obsługiwane), z domeną `resinvest.group` zweryfikowaną w DNS |

## 7. Google (wariant Gmail)

- Google Cloud Console → Ekran zgody OAuth (zewnętrzny albo wewnętrzny dla Workspace) → identyfikator klienta „Aplikacja internetowa”.
- Przekierowanie: `https://<adres>/api/auth/oidc/google/callback` (HTTPS jak wyżej).
- `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`; weryfikacja `id_token`: `iss` = `https://accounts.google.com`, `aud`, `email_verified = true`.
- Google Workspace z własną domeną: dodatkowo `hd` = domena firmy. Konta `@gmail.com` nie mają `hd` — o dostępie decydują `COMPANY_DOMAINS` i istnienie konta w ResInvest ERP.
- Poczta z Gmaila (`smtp.gmail.com:465`) wymaga **hasła aplikacji** (konto z weryfikacją dwuetapową). Docelowo XOAUTH2 jak w punkcie 6.

## 8. Zmiany w kodzie (wariant A)

| Plik | Zmiana |
|---|---|
| `server/oidc.mjs` (nowy) | konfiguracja dostawców, PKCE, `state` / `nonce`, wymiana kodu, JWKS z cache (24 h, odświeżenie przy nieznanym `kid`), weryfikacja JWT przez `node:crypto` |
| `server/core.mjs` | tabele `oidc_flows` (jednorazowe, 5 min) i `identities` (`provider`, `subject`, `tenant`, `user_id`, `linked_at`); migracja schematu bazy |
| `server/riw-server.mjs` | trasy `/api/auth/oidc/:provider/start` i `/callback`; ta sama sesja i limity IP co przy haśle; nagłówek CSP bez zmian (przekierowania tylko serwerowe) |
| `app/src/core.js` | przyciski „Zaloguj przez Microsoft 365 / Google” (widoczne, gdy serwer zgłosi dostawców w `/api/health`) |
| `app/src/admin.js` | karta użytkownika: „Powiązane konto Microsoft” (odłączenie), filtr „logowanie tylko SSO” |
| `server/mail.mjs` | `SMTP_AUTH=oauth2` (XOAUTH2) dla Microsoft 365 i Google |
| testy | atrapa dostawcy OIDC (lokalny serwer z kluczem RSA): poprawny token, zły podpis, zły `aud` / `iss` / `tid`, wygasły, powtórzony `state`, inny tenant z tym samym adresem, konto nieaktywne, domena spoza `COMPANY_DOMAINS`; E2E przycisku z atrapą |

## 9. Harmonogram

| Etap | Zakres | Czas |
|---|---|---|
| 1 | Rejestracja aplikacji w Entra ID, HTTPS dla serwera (certyfikat / proxy) | 1–2 dni (administrator) |
| 2 | `oidc.mjs` + tabele + trasy + testy z atrapą | 3–4 dni |
| 3 | Ekran logowania, karta użytkownika, audyt, dokumentacja | 1–2 dni |
| 4 | SMTP XOAUTH2 dla Microsoft 365 | 1–2 dni |
| 5 | Pilotaż: 2–3 osoby, potem cała firma; wyłączenie haseł (opcjonalnie) | 1 tydzień |
| 6 | Google — ten sam mechanizm, inny dostawca | 1 dzień |

## 10. Ryzyka

- **HTTPS jest obowiązkowy** dla przekierowań Microsoft i Google (poza `localhost`). Bez nazwy domenowej i certyfikatu logowanie M365 nie zadziała w sieci LAN po adresie IP.
- Wygaśnięcie klucza tajnego klienta zablokuje logowanie SSO. Ostrzeżenie na pulpicie administratora 30 dni wcześniej; hasło lokalne jako awaryjne.
- Zawężenie `COMPANY_DOMAINS` (np. przejście z wariantu „bez ograniczeń” na „Firma”) zablokuje konta z innych domen — także administratora. Przed zmianą wariantu sprawdź listę użytkowników.

## 11. Źródła

- [MC786329 — Exchange Online to retire Basic Auth for Client Submission (SMTP AUTH)](https://mc.merill.net/message/MC786329?from=1&to=4)
- [Microsoft Q&A — Exchange Online to retire Basic auth for Client Submission](https://learn.microsoft.com/en-us/answers/questions/5645009/exchange-online-to-retire-basic-auth-for-client-su)
- [End of Basic Auth SMTP on Exchange Online — harmonogram i migracja](https://www.captaindns.com/en/blog/microsoft-exchange-basic-auth-smtp-end)

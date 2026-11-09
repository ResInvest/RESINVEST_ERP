# ResInvest ERP 3.13 — poczta, rejestracja i logowanie: diagnoza i plan naprawy trzech instalatorów

Dokument dla administratora i działu IT. Opisuje:
- dlaczego e-mail rejestracyjny nie wychodził,
- co zostało naprawione w wersji 3.13,
- co jeszcze trzeba zrobić w każdym z trzech instalatorów,
- jakie dane i decyzje są potrzebne po stronie firmy, żeby poczta, rejestracja i logowanie działały bez wyjątków.

---

## 1. Diagnoza — dlaczego nie wychodził e-mail rejestracyjny

| # | Przyczyna | Gdzie | Skutek |
|---|---|---|---|
| 1 | Instalator tworzy `C:\ProgramData\ResInvestERP\server.env` z `EMAIL_TRANSPORT=smtp` i **pustym hasłem `SMTP_PASS=`**. Dotyczy wszystkich trzech wariantów. | instalatory 3.12 | Każda wysyłka (zaproszenie, potwierdzenie rejestracji, reset hasła) kończyła się błędem „brak hasła SMTP_PASS”. |
| 2 | Wariant **Bez ograniczeń** ma dodatkowo pusty `SMTP_HOST`. Serwer podstawiał wtedy `smtp.resend.com`, czyli serwer obcego dostawcy, do którego firma nie ma konta. | serwer 3.12 (`mailConfig`) | Ta sama blokada, a do tego myląca nazwa serwera w dzienniku. |
| 3 | Użytkownik widział tylko ogólny komunikat: „Sprawdź konfigurację poczty (dziennik serwera)”, bez przyczyny i bez wskazówki. | interfejs | Nie było wiadomo, co poprawić. |
| 4 | Pocztę dało się ustawić tylko edycją `server.env` w Notatniku i restartem serwera. | instalacja | Łatwo o pomyłkę, np. hasło ze znakiem `#` albo spacją było obcinane. |
| 5 | Zaproszenie, którego nie udało się wysłać, kasowało link. | serwer 3.12 | Konto czekało, a nowej osoby nie dało się wpuścić bez poczty. |
| 6 | Pusty `APP_URL`, czyli adres programu w linkach. Serwer zgaduje adres i bierze pierwszy adres IP komputera, a przy VPN może to być zły interfejs. | `server.env` | Linki w e-mailach nie otwierały się na innych komputerach. |

Typowe błędy **po uzupełnieniu hasła** (od 3.13 program pokazuje każdy z nich z instrukcją, co zrobić):

- **Microsoft 365, `535 5.7.139` (SmtpClientAuthentication is disabled):** w organizacji albo w skrzynce wyłączone jest *Uwierzytelnione SMTP* (tak jest domyślnie w nowych organizacjach i przy włączonym *Security defaults*).
- **Microsoft 365, `5.7.60` (SendAsDenied):** adres nadawcy różni się od skrzynki, na którą program się loguje.
- **Gmail, `535 5.7.8` (BadCredentials):** Gmail nie przyjmuje zwykłego hasła. Potrzebne jest **hasło aplikacji** (16 liter), a do niego włączona weryfikacja dwuetapowa.
- **Zapora lub antywirus:** blokada portów 587/465, albo przechwytywanie SSL, które psuje certyfikat serwera poczty.

**Tryb lokalny** (plik `ResInvest_ERP.html` otwarty bez serwera) z zasady nie wysyła e-maili: przeglądarka nie może łączyć się z serwerem SMTP. Rejestracja i zaproszenia e-mail działają tylko w **ResInvest ERP Serwer**.

## 2. Co naprawia wersja 3.13

1. **Poczta → Konfiguracja poczty** (dostępna tylko dla administratora):
   - gotowe ustawienia dla Microsoft 365, Gmail, Outlook.com i innego serwera;
   - pola: login, hasło, nadawca, adres programu w linkach;
   - zapis do `C:\ProgramData\ResInvestERP\server.env` działa **od razu, bez restartu**;
   - hasło jest tylko do zapisu: serwer nigdy nie odsyła go do przeglądarki;
   - znaki `#`, `$` i spacje w haśle są zapisywane poprawnie;
   - zmiana trafia do dziennika audytu.
2. **„Wyślij test”** wysyła od razu (bez kolejki) na wskazany adres. Wynik pojawia się w tym samym oknie: dokładny błąd serwera poczty i wskazówka, co zrobić (Microsoft 365, Gmail, sieć, certyfikat, port).
3. **Zaproszenie, którego nie udało się wysłać:** konto i tak powstaje, a administrator dostaje okno z przyczyną i linkiem zaproszenia do przekazania innym kanałem (Teams, SMS, wiadomość z własnej skrzynki), z przyciskiem „Kopiuj link”. Jeśli link wskazuje na `localhost`, okno ostrzega, że inne komputery go nie otworzą.
4. **Pusty `SMTP_HOST`** oznacza teraz „poczta nieskonfigurowana”, a nie obcy serwer Resend.
5. **Gmail:** spacje w haśle aplikacji (`abcd efgh ijkl mnop`) są usuwane automatycznie.
6. **Nadawca:** dla Microsoft 365, Outlook.com i Gmail nadawca jest ustawiany na zalogowaną skrzynkę (zapobiega błędowi 5.7.60).
7. **Pulpit administratora** ostrzega „Poczta nie jest skonfigurowana”, dopóki wysyłka nie jest gotowa. `/api/health` podaje `mailReady`.
8. **Rejestracja z ekranu logowania:** nadal bez szczegółów technicznych dla osoby z zewnątrz. Przyczyna trafia do dziennika serwera, a administrator może wysłać potwierdzenie ponownie z modułu Użytkownicy.

Testy:
- `tests/mail313.test.mjs`: konfiguracja z programu, test wysyłki, link zaproszenia, wskazówki, zapis haseł ze znakami specjalnymi;
- `tests/e2e313.cjs`: przeglądarka i serwer, lokalny przekaźnik SMTP;
- `tests/smtp.test.mjs`: STARTTLS/SSL, AUTH PLAIN/LOGIN.

**Nie sprawdzone tutaj:** prawdziwa wysyłka przez Microsoft 365 i Gmail. To środowisko testowe nie ma kont ani haseł firmy. Ten krok to pierwszy punkt odbioru po instalacji (punkt 4).

## 3. Plan naprawy trzech instalatorów

### 3.1. Wspólne dla wszystkich wariantów

| Etap | Zmiana | Po co | Stan |
|---|---|---|---|
| A | Konfiguracja poczty w programie zamiast Notatnika | bez edycji plików i restartu | **zrobione w 3.13** |
| B | Strona kreatora instalatora **„Poczta”**: dostawca, login, hasło. Zapis do `server.env` z uprawnieniami *Administratorzy + SYSTEM*. Na końcu instalacji test `riw-server --mail-test <adres>`. | poczta działa od pierwszego uruchomienia | do zrobienia (Inno Setup: strona `CreateInputQueryPage`, hasło jako pole maskowane, ACL `icacls`) |
| C | Strona kreatora **„Adres programu”** (`APP_URL`): podpowiedź z nazwą komputera (`http://<NAZWA>:8080`) i sprawdzenie, czy nazwa rozwiązuje się w sieci | linki w e-mailach otwierają się na innych komputerach | do zrobienia |
| D | **Serwer jako usługa Windows** (WinSW albo NSSM) zamiast autostartu przy logowaniu użytkownika | program i wysyłka działają też wtedy, gdy nikt nie jest zalogowany | do zrobienia |
| E | **Podpis cyfrowy instalatora** (certyfikat Code Signing, najlepiej EV) | brak ostrzeżenia SmartScreen, zaufanie działu IT | wymaga zakupu certyfikatu |
| F | **HTTPS** serwera (certyfikat z wewnętrznego CA firmy albo reverse proxy) | ciasteczko sesji z flagą Secure, bezpieczne linki | do zrobienia (serwer już obsługuje `tls` w `server.config.json`) |
| G | Test odbiorczy na prawdziwym Windows: `installer/test-windows/Uruchom-test.cmd` (od 3.13 także `mail313` i `smtp`) | potwierdzenie na docelowym komputerze | czeka na uruchomienie na komputerze testowym |

### 3.2. Wariant **Firma** (`@resinvest.group`, Microsoft 365)

1. **Teraz (SMTP AUTH):** administrator Microsoft 365 włącza *Uwierzytelnione SMTP* dla skrzynki `magazyn@resinvest.group`:
   - albo w centrum administracyjnym: *Użytkownicy → skrzynka → Poczta → Zarządzaj aplikacjami poczty e-mail*,
   - albo w PowerShell: `Set-CASMailbox magazyn@resinvest.group -SmtpClientAuthenticationDisabled $false`.

   Przy MFA tworzy hasło aplikacji. Potem w programie: *Poczta → Konfiguracja poczty → Microsoft 365 → hasło → Zapisz → Wyślij test*.
2. **Docelowo (zalecane):** wysyłka przez **Microsoft Graph `sendMail`** z rejestracją aplikacji w Entra ID, bez hasła skrzynki:
   - poświadczenia klienta (certyfikat albo sekret), uprawnienie aplikacji `Mail.Send`;
   - zawężenie uprawnienia do jednej skrzynki: *Application Access Policy* albo RBAC for Applications.

   Powód: Microsoft wycofuje podstawowe uwierzytelnianie w SMTP AUTH (komunikat MC786329; aktualny termin trzeba sprawdzić w Centrum wiadomości M365). Do zrobienia w kodzie: nowy transport `graph` w `server/mail.mjs` (OAuth2 client credentials, token w pamięci, odnawianie).
3. **Adres serwera:** stała nazwa DNS w sieci firmy, np. `erp-biomasa.ue.cz`, oraz reguła FortiGate dla portu 8080 (albo 443). Ustala to dział IT United Energy. Adres VPN komputera (10.212.212.29) zmienia się przy każdym połączeniu, więc nie nadaje się na `APP_URL`.

### 3.3. Wariant **Gmail** (`@gmail.com`, `@googlemail.com`)

1. Konto Gmail nadawcy z włączoną **weryfikacją dwuetapową**, a w nim **hasło aplikacji** (*myaccount.google.com → Bezpieczeństwo → Hasła aplikacji*).
2. W programie: *Poczta → Konfiguracja poczty → Gmail → login (adres Gmail) → hasło aplikacji → Zapisz → Wyślij test*.
3. Limity Google: zwykłe konto Gmail pozwala na około **500 odbiorców na dobę**, Google Workspace na około 2000. Przy większej liczbie powiadomień wybierz Google Workspace albo dostawcę wysyłki transakcyjnej (punkt 3.4).
4. Docelowo: **OAuth2 (XOAUTH2)** dla Gmail zamiast hasła aplikacji, bo Google stopniowo ogranicza logowanie hasłem. Wymaga projektu w Google Cloud i zgody OAuth.

### 3.4. Wariant **Bez ograniczeń** (dowolna domena)

1. Po instalacji poczta jest **świadomie nieskonfigurowana**. Pulpit administratora pokazuje ostrzeżenie, a zaproszenia działają przez link do przekazania.
2. Zalecane: własna domena firmy i dostawca wysyłki transakcyjnej (Resend, SendGrid, Mailgun, Amazon SES albo SMTP hostingu), z rekordami **SPF, DKIM i DMARC** w DNS domeny. Bez nich wiadomości trafiają do spamu.
3. Konfiguracja w programie: *Poczta → Konfiguracja poczty → Inny serwer* (adres, port 465 SSL albo 587 STARTTLS, login, hasło).

## 4. Odbiór po instalacji (lista kontrolna)

1. Program startuje, logowanie kontem startowym, wymuszona zmiana hasła.
2. *Poczta → Konfiguracja poczty* → zapis → **Wyślij test** na prywatny adres → wiadomość dochodzi i nie trafia do spamu.
3. *Użytkownicy → Dodaj użytkownika* → zaproszenie dochodzi → link otwiera się **na innym komputerze lub telefonie** → ustawienie hasła → logowanie.
4. *Nie pamiętam hasła* na ekranie logowania → e-mail z linkiem → nowe hasło.
5. Jeśli rejestracja z ekranu logowania jest włączona: zgłoszenie → e-mail potwierdzający → administrator nadaje rolę i magazyn.
6. *Poczta* → dziennik wysyłki bez pozycji „Nieudane”.
7. Kopia zapasowa bazy (*Administracja → Kopie serwera*) i, w wariancie Firma, druga kopia w folderze firmy.

## 5. Czego potrzebujemy od firmy

| Dla | Co | Od kogo |
|---|---|---|
| Wszystkie | Komputer serwera pracujący stale, ze stałym adresem (nazwa DNS albo stały IP) | dział IT |
| Wszystkie | Decyzja: dostęp tylko w sieci firmy / VPN, czy także z internetu (wtedy obowiązkowo HTTPS i reverse proxy) | zarząd + IT |
| Wszystkie | Certyfikat podpisu kodu (instalator) i certyfikat HTTPS | zakup / CA firmy |
| Firma | Włączone *Uwierzytelnione SMTP* dla `magazyn@resinvest.group` + hasło (albo hasło aplikacji), **albo** rejestracja aplikacji w Entra ID (Tenant ID, Client ID, certyfikat lub sekret, uprawnienie `Mail.Send` zawężone do skrzynki) | administrator Microsoft 365 |
| Firma | Reguła FortiGate dla portu serwera i nazwa DNS | IT United Energy |
| Gmail | Konto Gmail z weryfikacją dwuetapową i hasłem aplikacji | właściciel konta |
| Bez ograniczeń | Dane SMTP od dostawcy albo konto u dostawcy wysyłki + dostęp do DNS domeny (SPF, DKIM, DMARC) | właściciel domeny |

Hasła wpisuje administrator w programie albo w kreatorze instalatora. **Hasła nie są przesyłane w czacie ani zapisywane w repozytorium**: `server.env` z hasłem istnieje tylko na komputerze serwera.

## 6. Idealny program — rejestracja, logowanie, poczta (plan rozwoju)

**Już działa:**
- logowanie e-mailem służbowym;
- hasła: scrypt na serwerze, PBKDF2 lokalnie;
- sesja w ciasteczku HttpOnly;
- blokada po 5 błędnych hasłach i limit prób z jednego adresu IP;
- wylogowanie po 30 minutach bezczynności;
- zaproszenia z jednorazowym linkiem (72 h);
- reset hasła (1 h);
- potwierdzenie adresu (48 h);
- samodzielna rejestracja z zatwierdzeniem przez administratora;
- dziennik logowań i audytu;
- kolejka poczty z ponowieniami (1 min, 5 min, 15 min, 1 h, 6 h);
- od 3.13: konfiguracja poczty w programie i link zastępczy przy błędzie wysyłki.

| Priorytet | Funkcja | Opis |
|---|---|---|
| 1 | Kreator poczty i adresu w instalatorze | punkty 3.1 B i C |
| 1 | Serwer jako usługa Windows | punkt 3.1 D |
| 2 | Transport Microsoft Graph (`EMAIL_TRANSPORT=graph`) | wysyłka bez hasła skrzynki, zgodna z polityką Microsoft |
| 2 | Logowanie kontem Microsoft 365 / Google (OIDC) | plan: [`LOGOWANIE_M365_GOOGLE_PLAN.md`](LOGOWANIE_M365_GOOGLE_PLAN.md); MFA i dostęp warunkowy po stronie dostawcy |
| 2 | HTTPS i ciasteczko `Secure` | punkt 3.1 F |
| 3 | Drugi składnik dla kont lokalnych (TOTP, aplikacja Authenticator) | dla kont bez M365/Google |
| 3 | Odbicia i zwroty (bounce) w dzienniku poczty | wymaga dostawcy z webhookami (Resend, SendGrid) albo skrzynki zwrotnej |
| 3 | Szablony e-mail w języku odbiorcy (PL / CS / EN) | dziś szablony są po polsku |
| 4 | Powiadomienie administratora, gdy kolejka poczty ma pozycje „porzucone” | e-mail albo dzwonek w programie |

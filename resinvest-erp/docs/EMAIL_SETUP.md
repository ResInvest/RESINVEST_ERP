# Poczta e-mail (Resend) — konfiguracja ResInvest ERP Serwer 3.2

Serwer wysyła: **zaproszenia**, **potwierdzenie adresu e-mail**, **reset hasła**, powiadomienia
**zmiana adresu e-mail**, **hasło zmienione**, **konto dezaktywowane**. Szablony (język polski, marka ResInvest ERP,
wersja HTML + tekstowa) są w `server/mail.mjs` (`TEMPLATES`).

> **Stan weryfikacji:** wysyłka przez Resend (API i SMTP) jest zaimplementowana, ale w środowisku, w którym powstał
> program, **nie mogła zostać sprawdzona na prawdziwym koncie** (brak klucza API i dostępu do DNS domeny).
> Testy automatyczne sprawdzają pełny przebieg z transportem `file` (wiadomości `.eml` z linkami) oraz zachowanie
> przy błędzie wysyłki. Pierwszą prawdziwą wysyłkę wykonaj poleceniem `--mail-test` (punkt 5).

## 1. Konto i domena w Resend

1. Załóż konto na https://resend.com (administrator IT firmy).
2. **Domains → Add Domain** → `resinvest.group` (albo subdomena, np. `mail.resinvest.group` — wtedy nadawca
   `no-reply@mail.resinvest.group`).
3. Resend pokaże rekordy DNS do dodania u operatora domeny. **Wpisz dokładnie wartości z panelu Resend** —
   ten dokument nie podaje ich na sztywno (klucz DKIM jest unikalny dla konta):

| Rekord | Typ | Cel |
|---|---|---|
| SPF (np. `send.resinvest.group`) | TXT (+ MX dla domeny zwrotnej) | autoryzacja serwerów Resend |
| DKIM (`resend._domainkey…`) | TXT | podpis wiadomości |
| DMARC (`_dmarc.resinvest.group`) | TXT | polityka dla nieautoryzowanej poczty — zalecany start: `v=DMARC1; p=none; rua=mailto:…` a po sprawdzeniu raportów `p=quarantine` |

4. Poczekaj na status **Verified** (zwykle minuty–godziny, zależnie od DNS). Bez weryfikacji Resend odrzuci wysyłkę
   z adresu w domenie `resinvest.group`.
5. **API Keys → Create API Key** — uprawnienie **Sending access**, ograniczone do domeny. Klucz (`re_…`) pokazuje się
   tylko raz.

Program **nie tworzy rekordów DNS** — wykonuje to osoba z dostępem do panelu domeny.

## 2. Konfiguracja serwera (`server.env`)

Instalator Windows tworzy przy pierwszej instalacji plik **`C:\ProgramData\ResInvestERP\server.env`**
(skrót: *Menu Start → ResInvest ERP → Konfiguracja poczty i adresu*). Wzór: `.env.example`.

```ini
APP_URL=http://192.168.1.20:8080          # adres, pod którym pracownicy otwierają program (linki w e-mailach)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx     # klucz z punktu 1.5 — NIE commituj do repozytorium
EMAIL_FROM=ResInvest ERP <no-reply@resinvest.group>
EMAIL_REPLY_TO=magazyn@resinvest.group     # opcjonalnie
EMAIL_TRANSPORT=                           # puste = resend (gdy jest klucz Resend), agentmail (gdy jest tylko klucz AgentMail), inaczej file
```

Kolejność odczytu (późniejsze nadpisują wcześniejsze): `<program>\.env` → `<program>\config\server.env` →
`<dataDir>\server.env` → zmienne środowiskowe systemu. Po zmianie pliku **uruchom serwer ponownie**.
Konsola serwera pokazuje przy starcie: transport, nadawcę, adres linków i ewentualny brak klucza (bez wartości klucza).

Uprawnienia pliku (zalecane na komputerze z wieloma kontami Windows):

```bat
icacls "C:\ProgramData\ResInvestERP\server.env" /inheritance:r /grant:r Administratorzy:F SYSTEM:F "%USERNAME%":R
```

(konto, na którym działa serwer, musi mieć prawo odczytu).

## 3. Transporty

| `EMAIL_TRANSPORT` | Działanie |
|---|---|
| `resend` (domyślny przy kluczu) | `POST https://api.resend.com/emails`, nagłówek `Authorization: Bearer <klucz>`, limit czasu 15 s |
| `agentmail` (domyślny przy samym `AGENTMAIL_API_KEY`) | `POST https://api.agentmail.to/v0/inboxes/<AGENTMAIL_INBOX>/messages/send`, nagłówek `Authorization: Bearer <klucz>`, limit czasu 20 s — patrz punkt 4a |
| `smtp` | dowolny serwer SMTP firmy: SSL (465) albo STARTTLS (587), logowanie AUTH PLAIN/LOGIN — punkt 3a; domyślnie `smtp.resend.com:465` (użytkownik `resend`, hasło = klucz API) |
| `file` (domyślny bez klucza) | wiadomość `.eml` zapisana w `<dataDir>\mail-outbox` — **bez wysyłki**; administrator może otworzyć plik i przekazać link ręcznie |

Każda wysyłka jest zapisywana w tabeli `outbox` (czas, szablon, adresat, wynik, błąd) — widok:
*Dziennik audytu → Wiadomości e-mail*. Treść linków nie jest przechowywana.

## 3a. Poczta firmowa przez SMTP (od 3.9.1) — co jest potrzebne

Program **tylko wysyła** wiadomości (zaproszenia, reset hasła, potwierdzenia, powiadomienia, dokumenty PDF).
Do wysyłki wystarczy **SMTP**. **IMAP nie jest potrzebny** — służy do odbierania poczty, a program nie czyta skrzynki
(odpowiedzi na dokumenty trafiają do nadawcy dzięki nagłówkowi `Reply-To`).

Od administratora poczty / dostawcy potrzebujesz:

| Dane | Przykład | Gdzie wpisać (`server.env`) |
|---|---|---|
| Serwer SMTP | `smtp.office365.com` | `SMTP_HOST` |
| Port i szyfrowanie | `587` + STARTTLS albo `465` + SSL | `SMTP_PORT`, `SMTP_SECURE` |
| Skrzynka nadawcy (login) | `magazyn@resinvest.group` | `SMTP_USER` |
| Hasło (albo hasło aplikacji) | — | `SMTP_PASS` |
| Adres i nazwa nadawcy | `ResInvest ERP <magazyn@resinvest.group>` | `EMAIL_FROM` |
| Adres programu w linkach | `http://192.168.1.20:8080` | `APP_URL` |

Ustaw też `EMAIL_TRANSPORT=smtp`. Zalecana osobna skrzynka techniczna (np. `magazyn@` albo `erp@`), nie konto pracownika.

| Dostawca | `SMTP_HOST` | Port / `SMTP_SECURE` | Uwagi |
|---|---|---|---|
| Microsoft 365 / Exchange Online | `smtp.office365.com` | 587 / `starttls` | Administrator M365 musi włączyć dla skrzynki **Authenticated SMTP** (Centrum administracyjne → Użytkownicy → skrzynka → Poczta → Zarządzaj aplikacjami poczty e-mail). Przy MFA — hasło aplikacji albo wyjątek dla skrzynki technicznej. |
| Google Workspace | `smtp.gmail.com` | 465 / `ssl` (albo 587 / `starttls`) | Wymagana weryfikacja dwuetapowa i **hasło aplikacji** (16 znaków) jako `SMTP_PASS`. |
| home.pl | `<nazwa-serwera>.home.pl` | 465 / `ssl` | Nazwa serwera w panelu home.pl → Poczta → Konfiguracja programu pocztowego. |
| OVH, nazwa.pl, cyber_Folks, inne | z panelu dostawcy | zwykle 465 / `ssl` | Login = pełny adres e-mail. |
| Serwer w sieci firmy (przekaźnik) | adres IP / nazwa | 25 / `none` | Tylko gdy przekaźnik przyjmuje pocztę z IP serwera bez hasła; hasła bez szyfrowania program nie wysyła. |

Bezpieczeństwo:

- Certyfikat serwera poczty jest zawsze sprawdzany (TLS 1.2 lub nowszy). `SMTP_TLS_REJECT_UNAUTHORIZED=false` tylko dla
  własnego serwera z certyfikatem wewnętrznym.
- Przy STARTTLS program przerywa połączenie, jeśli serwer nie oferuje szyfrowania, zanim wyśle login i hasło.
- Hasło jest tylko w `server.env` na serwerze. Panel administratora i dziennik pokazują serwer, port, tryb i login — nigdy hasło.
- Aby wiadomości nie trafiały do SPAM-u, domena nadawcy powinna mieć rekordy SPF, DKIM i DMARC. Przy Microsoft 365 i Google
  Workspace zwykle są już ustawione przez dostawcę poczty.

Sprawdzenie: *Administracja → Wiadomość testowa* albo z konsoli `--mail-test adres@firma.pl` (punkt 5).
Panel *Dziennik audytu → Wiadomości e-mail* pokazuje serwer SMTP, tryb szyfrowania i ewentualne braki w konfiguracji.

## 4. APP_URL

Linki w wiadomościach budowane są **wyłącznie** z `APP_URL` (lub — gdy go brak — z adresu IP serwera ustalonego
przez sam serwer). Nagłówek `Host` żądania nie jest używany (ochrona przed podmianą linku resetu hasła).
Dla dostępu spoza sieci lokalnej ustaw HTTPS (`tls.cert` / `tls.key` w `config/server.config.json` lub reverse proxy)
i `APP_URL=https://…`.

## 5. Test wysyłki

```bat
cd "C:\Program Files\ResInvest ERP"
runtime\node.exe --disable-warning=ExperimentalWarning server\riw-server.mjs --data "%ProgramData%\ResInvestERP" --mail-test twoj.adres@resinvest.group
```

Wynik `Wysłano (resend)` oznacza przyjęcie wiadomości przez Resend. Sprawdź skrzynkę (także SPAM) i w panelu Resend
zakładkę *Emails* (status *Delivered*).

## 4a. Kanał AgentMail (3.7.3) — alternatywa dla Resend

1. Załóż konto na https://console.agentmail.to, utwórz skrzynkę nadawcy (np. `resinvest-erp@agentmail.to`
   albo skrzynkę we własnej domenie — domena dodana i zweryfikowana w AgentMail: SPF, DKIM, DMARC; jeden rekord SPF
   na domenę, np. `v=spf1 include:spf.agentmail.to ~all`) i wygeneruj klucz API.
2. W `server.env` (na serwerze, nigdy w przeglądarce ani w repozytorium):

   ```
   AGENTMAIL_API_KEY=am_...
   AGENTMAIL_INBOX=resinvest-erp@agentmail.to
   EMAIL_TRANSPORT=agentmail        # wymagane tylko, gdy w pliku jest też RESEND_API_KEY
   # AGENTMAIL_API_URL=https://api.agentmail.eu   # region EU (opcjonalnie)
   ```
3. Uruchom serwer ponownie. Konsola i ekran *Poczta* pokazują kanał „AgentMail (API HTTPS)” i adres nadawcy;
   *Wyślij test do mnie* sprawdza wysyłkę.

### Nadawca `magazyn@resinvest.group` (ustawiony domyślnie w `server.env`)

Skrzynka w domenie firmy działa w AgentMail dopiero po dodaniu i weryfikacji domeny:

1. *console.agentmail.to → Domains → Add domain* → `resinvest.group`; panel pokaże rekordy DNS.
2. U dostawcy domeny dodaj rekordy **DKIM** (TXT) i **DMARC** z panelu AgentMail. **SPF** — tylko jeden rekord
   na domenę: dopisz `include:spf.agentmail.to` do istniejącego, np. `v=spf1 include:_spf.google.com include:spf.agentmail.to ~all`.
3. **Rekordów MX nie zmieniaj**, jeśli `magazyn@resinvest.group` jest już Twoją skrzynką (Gmail, Outlook itp.) — zmiana MX
   przeniosłaby odbiór całej poczty domeny do AgentMail. Program tylko **wysyła** — odpowiedzi trafią jak dotąd do Twojej skrzynki.
   (Jeśli panel AgentMail wymaga MX do weryfikacji, użyj subdomeny, np. `erp.resinvest.group`, i skrzynki
   `magazyn@erp.resinvest.group`, a w `EMAIL_REPLY_TO` wpisz `magazyn@resinvest.group`.)
4. Po weryfikacji: *Inboxes → Create* → `magazyn` @ `resinvest.group` (nazwa wyświetlana: ResInvest ERP).
5. `server.env`: `AGENTMAIL_API_KEY=am_...`, `AGENTMAIL_INBOX=magazyn@resinvest.group`; ponowne uruchomienie serwera.

Kanałem AgentMail idą wszystkie wiadomości programu (zaproszenia, reset hasła, potwierdzenie rejestracji, powiadomienia,
dokumenty i raporty z PDF) — przez tę samą kolejkę z ponowieniami. Nadawcą jest skrzynka `AGENTMAIL_INBOX`
(`EMAIL_FROM` nie jest używany); odpowiedzi na dokumenty trafiają do użytkownika, który je wysłał (Reply-To).
Serwer łączy się z API bezpośrednio przez HTTPS — pakiet npm `agentmail` nie jest potrzebny, instalator zostaje bez zależności.

## 5a. Wysyłka dokumentów i raportów (3.6)

Przycisk **Wyślij e-mailem** (raporty, kwit produkcji dnia, planer, historia, dokumenty) w trybie FIRMOWYM wysyła PDF
przez ten sam kanał (Resend / SMTP / pliki `.eml`) z kolejką i ponowieniami. Serwer sprawdza uprawnienie
`reports.export`, adresy (do 10), temat, rozmiar (maks. 8 MB) i to, że załącznik jest plikiem PDF; limit 40 wiadomości
z dokumentami na godzinę na użytkownika. Odpowiedź odbiorcy trafia do nadawcy (nagłówek Reply-To). Każda wysyłka
ma wpis **MAIL_DOCUMENT** w dzienniku audytu; po wysłaniu treść i załącznik są usuwane z kolejki (zostaje wpis w dzienniku).

Ograniczenie odbiorców do wybranych domen — `config\server.config.json`:

```json
"mail": { "documentDomains": ["resinvest.group", "odbiorca.pl"] }
```

Pusta lista = dowolny poprawny adres. Domena nadawcy (`EMAIL_FROM`) musi być zweryfikowana w Resend (punkt 1).

## 6. Błędy i rozwiązania

| Objaw (dziennik serwera `logs\server-RRRR-MM-DD.log`) | Przyczyna |
|---|---|
| `brak klucza RESEND_API_KEY / SMTP_PASS` | transport `resend`/`smtp` bez klucza |
| `Resend HTTP 401` / `403` | błędny lub cofnięty klucz, klucz bez uprawnienia do domeny nadawcy albo domena niezweryfikowana (punkt 1.4) — treść błędu Resend jest w dzienniku |
| `Resend HTTP 422` | niepoprawne dane wiadomości (np. format `EMAIL_FROM`) |
| `Resend HTTP 429` | przekroczony limit wysyłki konta |
| `SMTP AUTH (logowanie): 535` | złe hasło / login; Microsoft 365: wyłączony *Authenticated SMTP* albo MFA bez hasła aplikacji; Google: brak hasła aplikacji |
| `SMTP: serwer nie oferuje STARTTLS` | zły port (np. 465 z `SMTP_SECURE=starttls`) — ustaw 587/`starttls` albo 465/`ssl` |
| `self-signed certificate` / `unable to verify` | serwer poczty ma certyfikat wewnętrzny — popraw certyfikat albo `SMTP_TLS_REJECT_UNAUTHORIZED=false` |
| `SMTP MAIL: 550` / `RCPT: 550` | adres `EMAIL_FROM` inny niż skrzynka `SMTP_USER` (brak prawa „Wyślij jako”) albo odrzucony adresat |
| `brak hasła SMTP_PASS` / `brak SMTP_USER` | niepełna konfiguracja w `server.env` (widoczne też w panelu administratora) |
| `SMTP: przekroczony czas` | zapora blokuje port 465/587 albo zły `SMTP_HOST` |

Przy błędzie wysyłki zaproszenia konto pozostaje INVITED, a administrator widzi komunikat i może wysłać ponownie.
Użytkownik nigdy nie widzi szczegółów technicznych.

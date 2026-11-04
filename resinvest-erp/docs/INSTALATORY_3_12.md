# ResInvest ERP Serwer 3.12 — instalatory Windows (praca wielu osób)

Każdy instalator zawiera ten sam program:

- serwer Node.js (dołączony `node.exe`, bez instalowania Node),
- bazę **SQLite** w `C:\ProgramData\ResInvestERP` z dziennikiem zmian i kontrolą spójności,
- **kopie automatyczne** (codziennie o 2:00, przy starcie i przed aktualizacją; przechowywane 30 dni) oraz skrót *Kopia zapasowa bazy teraz*,
- **logowanie z sesją serwerową** (hasła scrypt, ciasteczko HttpOnly, blokada po 5 błędnych hasłach, wylogowanie po 30 min bezczynności).

Instalatory różnią się tylko wariantem kont i poczty.

| Plik | Wariant | Konta (e-mail) | Poczta | Konto startowe |
|---|---|---|---|---|
| `ResInvestERP_Serwer_Setup_3.12.0_Firma.exe` | firma | tylko `@resinvest.group` | Microsoft 365: `smtp.office365.com:587`, STARTTLS | `magazyn@resinvest.group` / `Admin1234` (zmiana przy pierwszym logowaniu) |
| `ResInvestERP_Serwer_Setup_3.12.0_Gmail.exe` | gmail | `@gmail.com`, `@googlemail.com` | Gmail: `smtp.gmail.com:465`, SSL, hasło aplikacji Google | brak — ekran *Pierwsze uruchomienie* w przeglądarce (adres Gmail) |
| `ResInvestERP_Serwer_Setup_3.12.0_BezOgraniczen.exe` | otwarta | **dowolna domena** (tryb firmowy bez ograniczenia do `@resinvest.group`) | dowolny SMTP — uzupełnij `SMTP_HOST` | `magazyn@resinvest.group` / `Admin1234` |

We wszystkich wariantach `EMAIL_TRANSPORT=smtp`.

## Instalacja

1. Uruchom wybrany instalator jako administrator → **Pełna instalacja (program i serwer)**.
   Opcjonalnie zaznacz autostart serwera przy logowaniu do Windows i regułę zapory dla portu 8080 (dostęp z sieci lokalnej).
2. Menu Start → **Konfiguracja poczty i adresu (server.env)**. Uzupełnij:
   - `APP_URL` — adres programu w sieci, np. `http://192.168.1.20:8080`,
   - `SMTP_USER` i `SMTP_PASS` (w wariancie Gmail: hasło aplikacji, w wariancie bez ograniczeń także `SMTP_HOST`).
3. Menu Start → **ResInvest ERP Serwer — uruchom**. Inne komputery i telefony otwierają `http://<adres-serwera>:8080/`.
4. Administrator zaprasza pracowników: **Ustawienia → Użytkownicy → Dodaj użytkownika**.

## Wariant Firma — folder firmy `\\ue.cz\EPRPL\Data\BIOMASA` (FortiClient VPN „United Energy - VPN”)

| Co | Gdzie | Dlaczego |
|---|---|---|
| Serwer i **baza SQLite** | dysk lokalny komputera z serwerem: `C:\Program Files\ResInvest ERP`, `C:\ProgramData\ResInvestERP` | baza pracuje w trybie WAL, który **nie działa na udziale sieciowym (SMB)** — grozi uszkodzeniem danych; po rozłączeniu VPN serwer straciłby bazę |
| Program dla pracowników | `\\ue.cz\EPRPL\Data\BIOMASA\ResInvest ERP` — `ResInvest_ERP.html`, instrukcja, skrót **ResInvest ERP (serwer).url** | Menu Start → *Opublikuj program w folderze firmy* (także jako opcja na końcu instalacji) |
| Kopie bazy | lokalnie `C:\ProgramData\ResInvestERP\backups` **i** `\\ue.cz\EPRPL\Data\BIOMASA\kopie` (`BACKUP_COPY_TO`) | druga kopia poza komputerem serwera; gdy VPN jest rozłączony, serwer działa dalej, a w dzienniku pojawia się ostrzeżenie |

- Publikacja i kopie na udziale wymagają połączenia FortiClient VPN i uprawnień konta Windows do folderu. Serwer uruchomiony jako zalogowany użytkownik korzysta z jego dostępu do udziału.
- **Adres serwera dla pracowników (`APP_URL`):** adres VPN komputera (np. `10.212.212.29`) jest przydzielany przy każdym połączeniu i zwykle nie jest osiągalny z innych komputerów VPN. Serwer dla wielu osób postaw na komputerze w sieci firmy ze stałym adresem albo nazwą DNS i wpisz go do `server.env`, np. `APP_URL=http://erp-biomasa.ue.cz:8080`. Ustala to dział IT United Energy (reguła FortiGate dla portu 8080).
- Login VPN nie jest zapisywany przez program — hasło VPN zostaje w FortiClient.

## Jak działa wariant

- `C:\Program Files\ResInvest ERP\config\edition.env` zawiera `COMPANY_DOMAINS` (domeny kont) i `RIW_EDITION`. Instalator **nadpisuje** ten plik przy każdej instalacji.
- `C:\ProgramData\ResInvestERP\server.env` to ustawienia administratora. Instalator tworzy go tylko przy pierwszej instalacji, z ustawieniami poczty wariantu, i **ma pierwszeństwo** przed `edition.env`. Aby zmienić domeny bez zmiany instalatora, wpisz tam `COMPANY_DOMAINS=…` (lista po przecinku albo `*`).
- Przy starcie serwer porównuje domeny z danymi. Różnicę zapisuje w danych i w **dzienniku audytu** („Konfiguracja serwera (server.env)”). Ekran logowania dostaje domeny z serwera jeszcze przed zalogowaniem.
- Wszystkie warianty mają ten sam identyfikator aplikacji, więc zmiana wariantu to **aktualizacja w miejscu**: baza, kopie, `server.env` i konta zostają.
  **Uwaga:** zawężenie domen (np. „Bez ograniczeń” → „Firma”) zablokuje logowanie kont z innych domen.

## Budowanie

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1                # Windows, Inno Setup 6.3+ / 7
```
```bash
bash installer/build-installer-wine.sh                                                # Linux, Wine (wine64 + wine32:i386)
EDITIONS="firma" bash installer/build-installer-wine.sh --skip-tests                  # wybrany wariant
```

Kroki budowy:
1. `ResInvest_ERP.html`;
2. testy;
3. `node.exe` z nodejs.org z kontrolą SHA-256;
4. dla każdego wariantu `node tools/make-edition.mjs <wariant>` → `installer/build/<wariant>/` i kompilacja z `/DEditionId=<wariant>`.

Wynik: `installer/Output/ResInvestERP_Serwer_Setup_3.12.0_*.exe`.
Definicje wariantów: `installer/editions/*.json`. Nowy wariant to nowy plik JSON i wpis na liście `EDITIONS` w `tools/make-edition.mjs`.

## Sprawdzone (3.12.0, budowa 03.11.2026)

- Kompilacja trzech instalatorów: Inno Setup 6.4.1 pod Wine, po ok. 28 MB każdy.
- Cicha instalacja każdego wariantu (`/VERYSILENT`) pod Wine: „Installation process succeeded”. Sprawdzone pliki: `edition.env`, `server.env` (`EMAIL_TRANSPORT=smtp`, preset SMTP, puste hasła), `app.config.json`, `server.config.json`, `runtime\node.exe`, serwer i silnik.
- Serwer uruchomiony z katalogu po instalacji: wersja 3.12.0, domeny zgodne z wariantem. Wariant Gmail startuje z ekranem pierwszej konfiguracji.
- Pod Wine nie powstał skrót autostartu (w prefiksie Wine brak folderu Autostart). W Windows ten folder istnieje — do potwierdzenia przy instalacji na Windows.
- **Instalacji na prawdziwym Windows w tej sesji nie wykonano** — zalecana próba na komputerze testowym przed wdrożeniem.

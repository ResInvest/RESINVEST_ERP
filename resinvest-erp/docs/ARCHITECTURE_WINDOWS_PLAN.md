# ResInvest ERP — plan architektury: program Windows, dysk firmowy przez FortiClient VPN, szyfrowanie, podwójna kopia, instalator

Stan wyjściowy (3.2.0, działa i jest przetestowany): serwer **Node.js 22 + SQLite** (`server/`), jeden interfejs
**`ResInvest_ERP.html`** (tryb FIRMOWY przez serwer, tryb OFFLINE w przeglądarce), logowanie e-mailem
`@resinvest.group` sprawdzanym na serwerze, hasła **scrypt**, sesje HttpOnly, role i izolacja magazynów, dziennik zmian
z łańcuchem SHA-256, kopie `VACUUM INTO`, instalator **Inno Setup** (`installer/`). Plan rozbudowuje ten system —
nie zakłada przepisania aplikacji.

---

## 0. Decyzja kluczowa: gdzie leży baza danych

Wymaganie: *„baza danych / pliki programu na dedykowanym dysku firmowym (sieciowym), dostęp dopiero po połączeniu FortiVPN”*.

**Nie należy otwierać pliku bazy SQLite bezpośrednio z udziału sieciowego (SMB) przez wiele komputerów.**
Blokady plików przez sieć są zawodne (ryzyko uszkodzenia bazy przy równoczesnym zapisie), a tryb WAL w ogóle nie działa
na sieciowym systemie plików (wymaga pamięci współdzielonej na jednym komputerze). To samo dotyczy każdej bazy
„plikowej” (Access, SQLite, pliki JSON).

| Wariant | Opis | Ocena |
|---|---|---|
| **A (zalecany)** | **ResInvest ERP Serwer** działa jako usługa Windows na serwerze / maszynie wirtualnej w sieci firmy. Baza leży na **dedykowanym dysku firmowym podłączonym do tego serwera** (lokalny wolumin / dysk SAN / VHDX), kopie trafiają na udziały sieciowe. Komputery pracowników łączą się z serwerem przez **HTTPS po FortiVPN** — nie mają dostępu do plików bazy. | jeden proces zapisuje bazę (bezpieczne transakcje), izolacja plików od użytkowników, obecny kod działa bez zmian architektury |
| B | Każdy komputer uruchamia program i zapisuje bezpośrednio na udział `\\serwer\ERP` | **odradzany**: uszkodzenia bazy przy pracy wielu osób, pliki widoczne dla każdego z prawem do udziału |
| C | Serwer bazy (PostgreSQL / SQL Server) w sieci firmy + serwer aplikacji | uzasadniony przy setkach tysięcy operacji / wielu lokalizacjach; migracja przez interfejs komend `RIW.Service` bez zmian ekranów |

Dalsza część planu opisuje **wariant A**. Wymaganie „dysk firmowy dostępny tylko po VPN” jest w nim spełnione tak:
dane leżą w sieci firmy, a komputer pracownika dociera do nich wyłącznie przez serwer, a do serwera — wyłącznie przez VPN.

```
 Komputer pracownika (Windows)                    Sieć firmy (za FortiGate)
 ┌───────────────────────────────┐   FortiVPN    ┌──────────────────────────────────────────┐
 │ ResInvest ERP (okno programu) │══(tunel)═════▶│ ResInvest ERP Serwer (usługa Windows)    │
 │  · kontrola VPN / serwera     │   HTTPS 443   │  · SQLite (WAL) na dysku D:\ResInvestERP │
 │  · brak dostępu do plików DB  │               │  · BitLocker, konto usługi (gMSA)        │
 └───────────────────────────────┘               │  · kopia A → \\nas\erp-snap (co dzień)   │
                                                 │  · kopia B → \\backup\erp-vault (szyfr.) │
                                                 └──────────────────────────────────────────┘
```

---

## 1. Technologia programu i instalatora

| Warstwa | Wybór | Uzasadnienie |
|---|---|---|
| Serwer | **Node.js (obecny kod)** jako **usługa Windows** (WinSW / `sc.exe` + konto usługi) | działający, przetestowany kod; brak przepisywania; `node:sqlite`, `node:crypto` bez bibliotek natywnych |
| Program na komputerze | **okno aplikacji na silniku Edge (WebView2)** — powłoka **.NET 8 (WPF), publikacja self-contained** | natywny program Windows (~kilka MB, bez dołączania Chromium jak w Electron), dostęp do API Windows: sprawdzanie VPN / udziałów, Menedżer poświadczeń, DPAPI, podpis kodu; WebView2 ma H.264/AAC, a autoodtwarzanie intro ustawia się w parametrach środowiska przeglądarki. Ten sam `ResInvest_ERP.html` co dziś |
| Alternatywa | Electron | ten sam język (JS) co serwer, ale instalator ~150 MB i osobne aktualizacje Chromium — uzasadnione tylko, jeśli program ma działać także na macOS / Linux |
| Etap przejściowy (już jest) | `ResInvestERP-Otworz.cmd` — okno Edge/Chrome `--app` z własnym profilem i polityką autoodtwarzania | działa od 3.2.0 bez dodatkowych składników |
| Instalator | **Inno Setup** (obecny, `PrivilegesRequired=admin`, PL/CS/EN) dla instalacji ręcznej + **WiX Toolset (MSI)** dla wdrożeń GPO / Intune | MSI: instalacja cicha i centralna, naprawa, aktualizacja; Inno: prosty kreator dla pojedynczych stanowisk |

### Instalator — wymagania
1. **Uprawnienia administratora**: Inno `PrivilegesRequired=admin` (jest), MSI `InstallScope="perMachine"` + `Privileged` w warunkach uruchomienia; komunikat PL, gdy brak uprawnień.
2. **Wymagane biblioteki**: WebView2 Evergreen Runtime (bootstrapper Microsoft; w Windows 11 zwykle obecny — instalator sprawdza klucz rejestru i doinstalowuje w razie braku), .NET 8 — niepotrzebny przy publikacji *self-contained*, `node.exe` (serwer) — dołączony i weryfikowany SHA-256 przy budowaniu (jest).
3. **Serwer**: rejestracja usługi `ResInvestERPServer` (start automatyczny, konto gMSA / wirtualne), reguła zapory **tylko dla podsieci VPN i LAN**, certyfikat TLS z firmowego CA, katalog danych z ACL (punkt 3.3).
4. **Podpis kodu** Authenticode (certyfikat firmowy, `signtool /tr <serwer znacznika czasu> /td sha256`) dla `.exe`, `.msi`, `node.exe` wrappera — brak ostrzeżeń SmartScreen.
5. **Aktualizacja** bez utraty danych: dane poza katalogiem programu (jest), migracje schematu automatyczne i addytywne (jest), kopia przed migracją (dodać: `backup("pre-upgrade")` przy zmianie wersji).
6. **Deinstalacja** nie usuwa danych ani kopii (jest), usuwa usługę i regułę zapory.

---

## 2. Wieloużytkownikowość, rejestracja i logowanie

| Wymaganie | Stan 3.2.0 | Plan |
|---|---|---|
| tylko `@resinvest.group` | **jest**: `validateCompanyEmail` na serwerze (dokładna domena, bez subdomen i podobnych nazw) i w przeglądarce | bez zmian; lista domen w `config/app.config.json` |
| rejestracja | **jest**: tylko zaproszenia administratora (token jednorazowy 72 h, e-mail Resend) | bez zmian |
| haszowanie haseł | **scrypt** (N=2^15, r=8, p=1) — algorytm „memory-hard” zalecany przez OWASP obok Argon2id | migracja do **Argon2id** (m=19–64 MiB, t=2–3, p=1): pole `algo` w tabeli `accounts` już istnieje → przy udanym logowaniu hasło jest haszowane ponownie nowym algorytmem (bez resetu haseł). Implementacja: `crypto.argon2` w nowszym Node.js LTS (sprawdzić dostępność w wersji dołączanej do instalatora) albo pakiet `argon2` |
| tokeny sesji | nieprzezroczyste tokeny 256 bit w ciasteczku HttpOnly/SameSite=Strict, w bazie skrót; bezczynność 30 min, maks. 12 h | **zalecenie: pozostawić** — natychmiastowe unieważnienie (wylogowanie, dezaktywacja, reset hasła). Jeśli wymagany JWT: *access token* 10 min (podpis EdDSA, klucz tylko na serwerze, claims: `sub`, `sid`, `ver`), *refresh token* rotowany w ciasteczku HttpOnly, skrót w bazie, lista unieważnień po `sid` — role i magazyny zawsze z bazy, nie z tokenu |
| brute force | blokada konta 5 prób / 15 min, limit IP, limit resetu hasła | + opóźnienie wykładnicze, alert do administratora po serii blokad |
| MFA (opcjonalnie) | — | TOTP dla ról ADMINISTRATOR i AUDYTOR |

---

## 3. Sieć: FortiClient VPN i dostępność dysku firmowego

### 3.1 Kontrola w programie na komputerze (przed ekranem logowania i co 15 s w tle)

Kolejne kroki — pierwszy niespełniony wyznacza stan i komunikat:

| # | Test | Jak | Stan przy błędzie |
|---|---|---|---|
| 1 | karta sieciowa VPN aktywna | `NetworkInterface.GetAllNetworkInterfaces()` — interfejs FortiClient (opis „Fortinet…”, nazwa konfigurowalna w `client.json`) w stanie *Up* | `VPN_OFF` |
| 2 | nazwa serwera rozwiązywana przez firmowy DNS | `Dns.GetHostAddressesAsync("erp.resinvest.local")` → adres z puli firmowej | `DNS_FAIL` |
| 3 | serwer osiągalny | TCP 443, limit 3 s | `SERVER_UNREACHABLE` |
| 4 | właściwy serwer i jego stan | `GET /api/health` przez TLS z przypięciem certyfikatu firmowego CA; `integrity: true`, `storage: "ok"` | `SERVER_ERROR` / `STORAGE_DOWN` |

Program **nie zapisuje niczego lokalnie jako źródła prawdy** — bez serwera nie da się zapisać operacji.

### 3.2 Kontrola dysku na serwerze
- przy starcie i co 60 s: zapis/odczyt/usunięcie pliku próbnego `D:\ResInvestERP\.probe`, kontrola znacznika `.riw-volume` (identyfikator woluminu — chroni przed zapisem na pusty katalog, gdy dysk nie jest podłączony), wolne miejsce > progu, `PRAGMA quick_check` raz na dobę;
- przy błędzie: **tryb tylko do odczytu** (komendy zmieniające dane → HTTP 503, kod `STORAGE`), wpis w dzienniku, e-mail do administratorów, `/api/health` zwraca `storage: "down"`; powrót automatyczny po 3 poprawnych próbach;
- kopie B na udział sieciowy — przy braku udziału kopia czeka w kolejce (`pending-offsite`), alarm po 24 h bez kopii.

### 3.3 Reakcja i komunikaty dla użytkownika

| Stan | Ekran | Działanie programu |
|---|---|---|
| `VPN_OFF` | „Brak połączenia z siecią firmy. Połącz się przez FortiClient VPN, a program połączy się automatycznie.” + przycisk **Otwórz FortiClient** + **Spróbuj ponownie** | ponawianie co 5 → 10 → 30 s; przejście dalej bez klikania po zestawieniu tunelu |
| `DNS_FAIL` / `SERVER_UNREACHABLE` | „VPN połączony, ale serwer ResInvest ERP nie odpowiada. Jeśli problem trwa ponad 5 minut, zgłoś go do IT.” + kod błędu i godzina | ponawianie; dziennik lokalny do zgłoszenia |
| `STORAGE_DOWN` | „Dysk firmowy z danymi jest chwilowo niedostępny. Podgląd działa, zapis jest wstrzymany.” | tryb odczytu, przyciski zapisu nieaktywne |
| utrata połączenia w trakcie pracy | pasek „Brak połączenia — nic nie zapisano” (jest w 3.2) | formularz zostaje (wersja robocza w pamięci sesji), ponowne wysłanie tym samym **kluczem idempotencji** (jest) — bez duplikatów dokumentów |
| sesja wygasła | ekran logowania z informacją | (jest) |

Komunikaty bez szczegółów technicznych (zasada z 3.2), szczegóły w dzienniku programu `%LOCALAPPDATA%\ResInvestERP\logs`.

---

## 4. Bezpieczeństwo danych i szyfrowanie

### 4.1 Warstwy
1. **Transmisja**: tunel FortiVPN + **TLS 1.2/1.3** na serwerze (certyfikat firmowego CA, HSTS). Dziś TLS jest opcjonalny w `server.config.json` — w produkcji obowiązkowy.
2. **Wolumin**: **BitLocker (XTS-AES 256)** na dysku danych serwera i dyskach kopii; klucze odzyskiwania w AD / Entra ID.
3. **Aplikacja (at-rest, AES-256-GCM)**: stan danych jest zapisywany jako dokument JSON (`state.json`) i dziennik zmian — szyfrowanie na poziomie aplikacji jest proste i nie wymaga zmiany silnika bazy:
   - losowy klucz danych (DEK, 256 bit) szyfruje kolumny `state.json` i `journal.args` (AES-256-GCM, losowy nonce 96 bit, `AAD = rev || schema`);
   - DEK jest „opakowany” kluczem głównym (KEK) chronionym przez **DPAPI (zakres maszyny, konto usługi)** albo — docelowo — HSM / Azure Key Vault; w bazie tylko `wrapped_dek` i identyfikator wersji klucza;
   - rotacja: nowy DEK, przeszyfrowanie w jednej transakcji, stare wersje tylko do odczytu kopii;
   - skróty haseł i tokenów już są jednokierunkowe (scrypt / SHA-256).
   Alternatywa: SQLCipher (szyfrowanie całego pliku bazy) — wymaga zamiany `node:sqlite` na moduł natywny z SQLCipher.
4. **Kopie**: szyfrowane **osobnym** kluczem kopii (punkt 5), niezależnym od klucza bazy.

### 4.2 Ochrona przed osobami w sieci, które nie są zalogowane do programu
- katalog danych: **ACL NTFS tylko dla konta usługi** (gMSA) i grupy administratorów serwera; dziedziczenie wyłączone; brak udziału sieciowego na katalogu bazy;
- udziały kopii: konto usługi ma prawo **tylko do tworzenia plików** (bez odczytu i usuwania), osobne konto do odtwarzania;
- zapora serwera: port 443 tylko z podsieci VPN i LAN biura; brak RDP / SMB z podsieci VPN do serwera ERP;
- nawet przy kradzieży pliku bazy: dane zaszyfrowane (4.1 p. 3), klucz poza plikiem;
- audyt: każda operacja administracyjna i każde logowanie (jest), + dziennik dostępu do API z adresem IP (jest).

---

## 5. Podwójna kopia zapasowa

| | **Kopia A — migawka** | **Kopia B — odizolowane archiwum** |
|---|---|---|
| Kiedy | przy zatrzymaniu serwera (zamknięcie / aktualizacja), codziennie o `backup.hour`, przy starcie gdy > 24 h, ręcznie (jest częściowo: start, dzień, ręcznie) | codziennie po kopii A + przed każdą aktualizacją programu |
| Co | `VACUUM INTO` — spójna kopia bazy bez zatrzymywania pracy (jest) | kopia A + manifest (`sha256`, rewizja, schemat, wersja programu) spakowane i zaszyfrowane **AES-256-GCM** (klucz kopii z DPAPI / Key Vault; zapasowa kopia klucza w sejfie zarządu) |
| Gdzie | `D:\ResInvestERP\backups` + `\\nas\erp-snap\` | inny serwer / NAS w innej lokalizacji albo chmura z **niezmiennością** (np. obiekt z blokadą zapisu); konto tylko do zapisu |
| Przechowywanie | 30 dni (jest) | dziadek–ojciec–syn: 14 dziennych, 8 tygodniowych, 12 miesięcznych, 5 rocznych |
| Kontrola | `--check` (suma stanu, łańcuch dziennika) | co tydzień automatyczne **odtworzenie próbne**: odszyfrowanie → `--check` → porównanie rewizji; raport e-mail; alarm przy błędzie lub braku kopii > 24 h |

Zasada 3-2-1: trzy kopie (baza + A + B), dwa nośniki, jedna poza budynkiem. Odtworzenie: `--restore` (jest) +
nowe `--restore-vault <archiwum>` (odszyfrowanie i weryfikacja manifestu przed podmianą bazy).

---

## 6. Plan realizacji krok po kroku

| Etap | Zakres | Wynik / kryterium odbioru |
|---|---|---|
| **1. Infrastruktura** (IT) | serwer / VM Windows Server w sieci firmy, dysk danych z BitLocker, DNS `erp.resinvest.local`, certyfikat z firmowego CA, podsieć VPN w FortiGate z dostępem tylko do 443 serwera ERP, gMSA | serwer osiągalny wyłącznie po VPN (test z komputera bez VPN: brak połączenia) |
| **2. Serwer jako usługa** | wrapper usługi Windows, TLS obowiązkowy, kontrola woluminu i tryb tylko do odczytu (3.2), kopia przy zatrzymaniu, `backup("pre-upgrade")` | testy: odłączenie dysku → 503 `STORAGE`, powrót → zapis działa; zatrzymanie usługi → kopia A |
| **3. Szyfrowanie danych** | AES-256-GCM dla `state.json` / `journal.args`, DPAPI, rotacja kluczy, migracja istniejącej bazy (jednorazowe zaszyfrowanie w transakcji z kopią przed) | test: plik bazy nie zawiera jawnych nazw kontrahentów; odtworzenie po rotacji klucza |
| **4. Kopia B** | archiwum szyfrowane, udział tylko do zapisu, harmonogram, retencja GFS, odtworzenie próbne, alarmy | raport tygodniowy z odtworzenia próbnego; test ransomware: konto usługi nie może usunąć archiwum |
| **5. Program na komputerze** | powłoka .NET 8 + WebView2: kontrola VPN/serwera (3.1), ekrany stanów (3.3), przypięcie certyfikatu, autoodtwarzanie intro, dziennik lokalny | testy: VPN wyłączony / serwer zatrzymany / dysk serwera odłączony / utrata sieci w trakcie zapisu (bez duplikatu) |
| **6. Hasła i sesje** | Argon2id z ponownym haszowaniem przy logowaniu; opcjonalnie MFA TOTP dla administratorów; (JWT tylko na wyraźne wymaganie — punkt 2) | test: stare konto scrypt loguje się i przechodzi na Argon2id |
| **7. Instalatory** | Inno Setup (jest) + WiX MSI (klient i serwer osobno), WebView2 bootstrapper, podpis kodu, instalacja cicha | wdrożenie GPO/Intune na 2 stanowiskach pilotażowych; aktualizacja z 3.2 bez utraty danych |
| **8. Pilotaż i odbiór** | 1 magazyn, 2 tygodnie, szkolenie, procedura awaryjna (brak VPN, odtworzenie kopii) | lista kontrolna odbioru, podpisana procedura odtworzenia |

Testy automatyczne każdego etapu dopisywane do obecnych zestawów (`tests/*.test.mjs`, E2E) — zasada z 3.x:
etap jest skończony, gdy testy przechodzą, a niesprawdzalne elementy są jawnie oznaczone jako NIEPOTWIERDZONE.

## 7. Ryzyka

| Ryzyko | Ograniczenie |
|---|---|
| praca bez VPN (np. w terenie) | tryb OFFLINE tylko do szkolenia; produkcyjnie — brak zapisu bez serwera (świadoma decyzja: jedno źródło prawdy) |
| utrata klucza szyfrowania | kopia KEK w sejfie / Key Vault z procedurą „dwóch osób”; test odtworzenia w etapie 4 |
| awaria serwera | kopia A na NAS + kopia B poza lokalizacją; czas odtworzenia (RTO) 2 h, utrata danych (RPO) ≤ 24 h — zmniejszana częstszą kopią A |
| SQLite przy dużym wzroście danych | wariant C (PostgreSQL) przez interfejs `RIW.Service`, bez zmian ekranów |

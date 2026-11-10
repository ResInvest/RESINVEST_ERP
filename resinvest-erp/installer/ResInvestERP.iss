; =========================================================================
;  ResInvest ERP 3.15 · instalator Windows (Inno Setup 7; zgodny z Inno Setup 6.3+)
;  Kodowanie pliku: UTF-8 z BOM (wymagane dla polskich i czeskich znaków — Inno Setup 7
;  przerywa kompilację przy bajtach niezgodnych ze stroną kodową pliku).
;
;  Budowanie (Windows, z katalogu resinvest-erp):
;    powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
;  Skrypt: buduje ResInvest_ERP.html, generuje dane przykładowe, pobiera
;  środowisko Node.js (node.exe, weryfikacja SHA-256) do installer\runtime
;  i kompiluje ten plik dla każdego wariantu (/DEditionId=firma|gmail|otwarta).
;  Wynik (installer\Output):
;    ResInvestERP_SerwerFirma.exe     — wariant firma,
;    ResInvestERP_GoogleSerwer.exe    — wariant gmail,
;    ResInvestERP_SerwerNoLimit.exe   — wariant otwarta (bez ograniczeń).
;  Kreator otwiera się na pełnym ekranie (okno zmaksymalizowane, elementy skalowane).
;
;  Warianty (installer\editions\*.json → tools\make-edition.mjs → installer\build\<wariant>\):
;   * firma   — konta tylko @resinvest.group, poczta Microsoft 365 (SMTP),
;   * gmail   — konta @gmail.com / @googlemail.com, poczta Gmail (SMTP, hasło aplikacji),
;   * otwarta — tryb firmowy bez ograniczenia domeny (dowolny adres e-mail), poczta SMTP.
;  Wszystkie warianty mają ten sam AppId: zmiana wariantu = aktualizacja w miejscu, dane zostają.
;
;  Składniki:
;   * Program (tryb lokalny)   — samodzielny plik HTML; dane w przeglądarce,
;                                logowanie lokalne, bez serwera i bez internetu.
;   * Serwer (wielostanowiskowy) — ResInvest ERP Serwer: Node.js + PostgreSQL (strona kreatora „Baza danych”:
;                                konto i baza programu, przeniesienie danych z SQLite przy aktualizacji;
;                                SQLite pozostaje jako tryb awaryjny / jednostanowiskowy),
;                                konta i sesje po stronie serwera, dziennik
;                                zmian z łańcuchem skrótów, kopie codzienne.
;                                Dane: C:\ProgramData\ResInvestERP (nie są
;                                usuwane przy odinstalowaniu). Poczta (zaproszenia,
;                                reset hasła): C:\ProgramData\ResInvestERP\server.env
;                                — tworzony z .env.example tylko przy pierwszej instalacji.
; =========================================================================

#ifndef EditionId
  #define EditionId "firma"
#endif
#include AddBackslash(SourcePath) + "build\" + EditionId + "\edition.iss"

#define AppName "ResInvest ERP"
#define AppVersion "3.15.0"
#define AppPublisher "ResInvest Commodities"
#define AppURL "http://localhost:8080/"
#define ServerPort "8080"

[Setup]
AppId={{8C1B7E52-3E0B-4B7A-9E0D-5B2D6A1F4C10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} Serwer {#AppVersion} ({#EditionName})
AppComments=Wariant: {#EditionName}; domeny kont: {#EditionDomains}
AppPublisher={#AppPublisher}
AppCopyright=Copyright (c) 2026 Mateusz Roesner — program stworzony dla ResInvest Commodities
VersionInfoCompany=ResInvest Commodities
VersionInfoDescription=ResInvest ERP — instalator
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\ResInvest ERP
DefaultGroupName=ResInvest ERP
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=Output
OutputBaseFilename={#EditionOutput}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 3.14: kreator na pełnym ekranie — okno skalowalne, maksymalizowane przy starcie (InitializeWizard)
WizardResizable=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayName={#AppName} Serwer {#AppVersion} ({#EditionName})
SetupIconFile=..\app\assets\icons\ric.ico
UninstallDisplayIcon={app}\ric.ico
CloseApplications=yes
SetupLogging=yes

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"
Name: "czech"; MessagesFile: "compiler:Languages\Czech.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
; ostatni ekran kreatora: jak zalogować się pierwszy raz (zależnie od wariantu)
#if EditionAdmin != ""
polish.FinishedLabel=Instalacja zakończona. Po kliknięciu „Zakończ” serwer uruchomi się i otworzy program (http://localhost:8080).%n%nPierwsze logowanie:%n   e-mail:  {#EditionAdmin}%n   hasło:  {#EditionAdminPassword}%nProgram poprosi o ustawienie własnego hasła.%n%nPoczta (zaproszenia, reset hasła): w programie Poczta → Konfiguracja poczty.%nInne komputery w sieci: http://<adres tego komputera>:8080
czech.FinishedLabel=Instalace dokončena. Po kliknutí na „Dokončit“ se spustí server a otevře program (http://localhost:8080).%n%nPrvní přihlášení:%n   e-mail:  {#EditionAdmin}%n   heslo:  {#EditionAdminPassword}%nProgram vás požádá o nastavení vlastního hesla.%n%nPošta (pozvánky, obnova hesla): v programu Pošta → Nastavení pošty.
english.FinishedLabel=Setup is complete. After you click Finish the server starts and opens the program (http://localhost:8080).%n%nFirst sign-in:%n   e-mail:  {#EditionAdmin}%n   password:  {#EditionAdminPassword}%nYou will be asked to set your own password.%n%nE-mail (invitations, password reset): in the program Mail → E-mail settings.
#else
polish.FinishedLabel=Instalacja zakończona. Po kliknięciu „Zakończ” serwer uruchomi się i otworzy program (http://localhost:8080).%n%nPierwsze uruchomienie: utwórz konto administratora (adres {#EditionDomains}) na ekranie, który się pojawi.%n%nPoczta (zaproszenia, reset hasła): w programie Poczta → Konfiguracja poczty.
czech.FinishedLabel=Instalace dokončena. Po kliknutí na „Dokončit“ se spustí server a otevře program (http://localhost:8080).%n%nPrvní spuštění: vytvořte účet administrátora (adresa {#EditionDomains}).%n%nPošta: v programu Pošta → Nastavení pošty.
english.FinishedLabel=Setup is complete. After you click Finish the server starts and opens the program (http://localhost:8080).%n%nFirst start: create the administrator account ({#EditionDomains}) on the screen that appears.%n%nE-mail: in the program Mail → E-mail settings.
#endif

[CustomMessages]
; 3.15: strona „Baza danych” kreatora (PostgreSQL, przeniesienie danych z SQLite)
polish.DbTitle=Baza danych PostgreSQL
czech.DbTitle=Databáze PostgreSQL
english.DbTitle=PostgreSQL database
polish.DbSub=Centralna baza programu: operacje, dokumenty, rejestry, historia, konta.
czech.DbSub=Centrální databáze programu: operace, doklady, registry, historie, účty.
english.DbSub=Central program database: operations, documents, registers, history, accounts.
polish.DbDesc=PostgreSQL 14 lub nowszy musi być zainstalowany (na tym albo innym komputerze w sieci firmy). Z hasłem administratora PostgreSQL instalator sam utworzy konto i bazę programu (puste hasło konta programu = hasło losowe, zapisane tylko w server.env); hasło administratora nie jest nigdzie zapisywane. Przy aktualizacji dotychczasowe dane z SQLite zostaną przeniesione do PostgreSQL z kontrolą zgodności każdej tabeli — plik SQLite pozostaje bez zmian jako punkt powrotu. Gdy coś się nie uda, serwer działa dalej na SQLite i nic nie jest tracone.
czech.DbDesc=PostgreSQL 14 nebo novější musí být nainstalován (na tomto nebo jiném počítači v síti firmy). S heslem administrátora PostgreSQL instalátor sám vytvoří účet a databázi programu (prázdné heslo účtu programu = náhodné heslo uložené jen v server.env); heslo administrátora se nikam neukládá. Při aktualizaci se dosavadní data ze SQLite přenesou do PostgreSQL s kontrolou shody každé tabulky — soubor SQLite zůstává beze změn jako bod návratu. Když se něco nepodaří, server dál běží na SQLite a nic se neztratí.
english.DbDesc=PostgreSQL 14 or newer must be installed (on this or another computer in the company network). With the PostgreSQL administrator password the installer creates the program account and database itself (empty program account password = random password stored only in server.env); the administrator password is not stored anywhere. On upgrade the existing SQLite data is moved to PostgreSQL with every table verified — the SQLite file stays unchanged as a fallback. If anything fails, the server keeps running on SQLite and nothing is lost.
polish.DbHost=Serwer PostgreSQL (adres lub nazwa komputera):
czech.DbHost=Server PostgreSQL (adresa nebo název počítače):
english.DbHost=PostgreSQL server (address or computer name):
polish.DbPort=Port:
czech.DbPort=Port:
english.DbPort=Port:
polish.DbName=Nazwa bazy programu:
czech.DbName=Název databáze programu:
english.DbName=Program database name:
polish.DbUser=Konto programu (bez uprawnień administratora):
czech.DbUser=Účet programu (bez oprávnění administrátora):
english.DbUser=Program account (without administrator rights):
polish.DbPass=Hasło konta programu (puste = wygeneruj):
czech.DbPass=Heslo účtu programu (prázdné = vygenerovat):
english.DbPass=Program account password (empty = generate):
polish.DbAdmin=Administrator PostgreSQL (do utworzenia konta i bazy):
czech.DbAdmin=Administrátor PostgreSQL (pro vytvoření účtu a databáze):
english.DbAdmin=PostgreSQL administrator (to create the account and database):
polish.DbAdminPass=Hasło administratora PostgreSQL (nie jest zapisywane):
czech.DbAdminPass=Heslo administrátora PostgreSQL (neukládá se):
english.DbAdminPass=PostgreSQL administrator password (not stored):
polish.DbSqlite=Bez PostgreSQL — pozostań na SQLite (jedno stanowisko, tryb awaryjny)
czech.DbSqlite=Bez PostgreSQL — zůstat na SQLite (jedno pracoviště, nouzový režim)
english.DbSqlite=Without PostgreSQL — stay on SQLite (single workstation, fallback mode)
polish.DbNeed=Podaj adres serwera PostgreSQL oraz hasło konta programu albo hasło administratora PostgreSQL.
czech.DbNeed=Zadejte adresu serveru PostgreSQL a heslo účtu programu nebo heslo administrátora PostgreSQL.
english.DbNeed=Enter the PostgreSQL server address and the program account password or the PostgreSQL administrator password.
polish.DbBusy=Przygotowanie bazy PostgreSQL i przenoszenie danych (może potrwać kilka minut)…
czech.DbBusy=Příprava databáze PostgreSQL a přenos dat (může trvat několik minut)…
english.DbBusy=Preparing the PostgreSQL database and moving the data (may take a few minutes)…
polish.DbFailed=Serwer działa dalej na dotychczasowej bazie — dane są bezpieczne. Aby spróbować ponownie, uruchom instalator jeszcze raz (strona „Baza danych” pojawi się znowu). Szczegóły: dziennik serwera i docs\POSTGRESQL.md.
czech.DbFailed=Server dál běží na dosavadní databázi — data jsou v bezpečí. Pro nový pokus spusťte instalátor znovu (stránka „Databáze“ se zobrazí znovu). Podrobnosti: protokol serveru a docs\POSTGRESQL.md.
english.DbFailed=The server keeps running on its current database — the data is safe. To try again, run the installer once more (the “Database” page appears again). Details: server log and docs\POSTGRESQL.md.
; 3.13: strona „Poczta” kreatora (zaproszenia, potwierdzenia rejestracji, reset hasła)
polish.MailTitle=Poczta
czech.MailTitle=Pošta
english.MailTitle=E-mail
polish.MailSub=Skrzynka, z której program wysyła zaproszenia, potwierdzenia rejestracji i reset hasła.
czech.MailSub=Schránka, ze které program posílá pozvánky, potvrzení registrace a obnovu hesla.
english.MailSub=Mailbox the program sends invitations, registration confirmations and password resets from.
polish.MailDesc=Wpisz login i hasło skrzynki, aby od razu wysłać wiadomość testową. Gmail: hasło aplikacji (16 liter) z myaccount.google.com → Bezpieczeństwo → Hasła aplikacji. Microsoft 365: hasło skrzynki z włączonym „Uwierzytelnionym SMTP”. Puste hasło = ustawisz później w programie (Poczta → Konfiguracja poczty). Hasło zapisuje się tylko na tym komputerze.
czech.MailDesc=Zadejte přihlášení a heslo schránky a hned se odešle testovací zpráva. Gmail: heslo aplikace (16 písmen). Microsoft 365: heslo schránky se zapnutým „Ověřeným SMTP“. Prázdné heslo = nastavíte později v programu (Pošta → Nastavení pošty). Heslo se ukládá jen na tomto počítači.
english.MailDesc=Enter the mailbox login and password to send a test message right away. Gmail: app password (16 letters). Microsoft 365: mailbox password with “Authenticated SMTP” enabled. Empty password = set it later in the program (Mail → E-mail settings). The password is stored on this computer only.
polish.MailHost=Serwer SMTP:
czech.MailHost=Server SMTP:
english.MailHost=SMTP server:
polish.MailPort=Port (465 = SSL, 587 = STARTTLS):
czech.MailPort=Port (465 = SSL, 587 = STARTTLS):
english.MailPort=Port (465 = SSL, 587 = STARTTLS):
polish.MailUser=Login — adres e-mail skrzynki:
czech.MailUser=Přihlášení — e-mailová adresa schránky:
english.MailUser=Login — mailbox e-mail address:
polish.MailPass=Hasło (Gmail: hasło aplikacji):
czech.MailPass=Heslo (Gmail: heslo aplikace):
english.MailPass=Password (Gmail: app password):
polish.MailApp=Adres programu w linkach e-mail (dla innych komputerów):
czech.MailApp=Adresa programu v odkazech e-mailů (pro ostatní počítače):
english.MailApp=Program address in e-mail links (for other computers):
polish.MailNeedUser=Podaj serwer SMTP i login (adres e-mail skrzynki) albo zostaw hasło puste.
czech.MailNeedUser=Zadejte server SMTP a přihlášení (adresu schránky), nebo nechte heslo prázdné.
english.MailNeedUser=Enter the SMTP server and login (mailbox address), or leave the password empty.
polish.MailBusy=Zapisywanie konfiguracji poczty i wysyłanie wiadomości testowej…
czech.MailBusy=Ukládání nastavení pošty a odesílání testovací zprávy…
english.MailBusy=Saving e-mail settings and sending a test message…
polish.MailLater=Poczta: zmienisz ją w programie (Poczta → Konfiguracja poczty).
czech.MailLater=Pošta: změníte ji v programu (Pošta → Nastavení pošty).
english.MailLater=E-mail: change it in the program (Mail → E-mail settings).
polish.CompLocal=Program — tryb lokalny (jedno stanowisko)
czech.CompLocal=Program — místní režim (jedno pracoviště)
english.CompLocal=Program — local mode (single workstation)
polish.CompServer=Serwer wielostanowiskowy (Node.js + PostgreSQL)
czech.CompServer=Víceuživatelský server (Node.js + PostgreSQL)
english.CompServer=Multi-user server (Node.js + PostgreSQL)
polish.TypeFull=Pełna instalacja (program i serwer)
czech.TypeFull=Úplná instalace (program a server)
english.TypeFull=Full installation (program and server)
polish.TypeLocal=Tylko program (tryb lokalny)
czech.TypeLocal=Pouze program (místní režim)
english.TypeLocal=Program only (local mode)
polish.TaskDesktop=Skrót na pulpicie
czech.TaskDesktop=Zástupce na ploše
english.TaskDesktop=Desktop shortcut
polish.TaskAutostart=Uruchamiaj serwer przy logowaniu do Windows
czech.TaskAutostart=Spouštět server při přihlášení do Windows
english.TaskAutostart=Start the server when signing in to Windows
polish.TaskFirewall=Zezwól na dostęp z sieci lokalnej (zapora, port {#ServerPort})
czech.TaskFirewall=Povolit přístup z místní sítě (brána firewall, port {#ServerPort})
english.TaskFirewall=Allow access from the local network (firewall, port {#ServerPort})
polish.Shortcuts=Skróty:
czech.Shortcuts=Zástupci:
english.Shortcuts=Shortcuts:
polish.ServerGroup=Serwer:
czech.ServerGroup=Server:
english.ServerGroup=Server:
polish.LnkLocal=ResInvest ERP (tryb lokalny)
czech.LnkLocal=ResInvest ERP (místní režim)
english.LnkLocal=ResInvest ERP (local mode)
polish.LnkServer=ResInvest ERP Serwer - uruchom
czech.LnkServer=ResInvest ERP Server - spustit
english.LnkServer=ResInvest ERP Server - start
polish.LnkOpen=ResInvest ERP (serwer) - otwórz w przeglądarce
czech.LnkOpen=ResInvest ERP (server) - otevřít v prohlížeči
english.LnkOpen=ResInvest ERP (server) - open in browser
polish.LnkBackup=Kopia zapasowa bazy teraz
czech.LnkBackup=Záloha databáze nyní
english.LnkBackup=Back up the database now
polish.LnkCheck=Kontrola spójności bazy
czech.LnkCheck=Kontrola konzistence databáze
english.LnkCheck=Database integrity check
polish.LnkData=Folder danych serwera
czech.LnkData=Složka dat serveru
english.LnkData=Server data folder
polish.LnkEnv=Ustawienia serwera (server.env)
czech.LnkEnv=Nastavení serveru (server.env)
english.LnkEnv=Server settings (server.env)
polish.LnkShare=Folder firmy (udział sieciowy)
czech.LnkShare=Složka firmy (síťová sdílená složka)
english.LnkShare=Company folder (network share)
polish.LnkPublish=Opublikuj program w folderze firmy
czech.LnkPublish=Publikovat program ve složce firmy
english.LnkPublish=Publish the program to the company folder
polish.RunPublish=Opublikuj program w folderze firmy %1 (wymaga połączenia VPN)
czech.RunPublish=Publikovat program ve složce firmy %1 (vyžaduje připojení VPN)
english.RunPublish=Publish the program to the company folder %1 (requires a VPN connection)
polish.LnkDocs=Instrukcja (README)
czech.LnkDocs=Návod (README)
english.LnkDocs=Manual (README)
polish.RunLocal=Uruchom ResInvest ERP (tryb lokalny)
czech.RunLocal=Spustit ResInvest ERP (místní režim)
english.RunLocal=Start ResInvest ERP (local mode)
polish.RunServer=Uruchom serwer i otwórz program
czech.RunServer=Spustit server a otevřít program
english.RunServer=Start the server and open the program
polish.Downgrade=Zainstalowana jest nowsza wersja ResInvest ERP (%1). Ten instalator zawiera wersję %2.%n%nInstalacja starszej wersji na nowszej bazie danych jest zablokowana. Aby wrócić do starszej wersji, przywróć kopię bazy „przed-aktualizacja” (instrukcja: docs\AKTUALIZACJE.md) i uruchom instalator z parametrem /ALLOWDOWNGRADE=1.
czech.Downgrade=Je nainstalována novější verze ResInvest ERP (%1). Tento instalátor obsahuje verzi %2.%n%nInstalace starší verze na novější databázi je zablokována. Pro návrat obnovte zálohu „przed-aktualizacja” (návod: docs\AKTUALIZACJE.md) a spusťte instalátor s parametrem /ALLOWDOWNGRADE=1.
english.Downgrade=A newer version of ResInvest ERP is installed (%1). This installer contains version %2.%n%nInstalling an older version over a newer database is blocked. To go back, restore the "przed-aktualizacja" database backup (see docs\AKTUALIZACJE.md) and run the installer with /ALLOWDOWNGRADE=1.
polish.Upgrading=Aktualizacja %1 → %2: zatrzymanie serwera i kopia bazy danych przed zmianą plików…
czech.Upgrading=Aktualizace %1 → %2: zastavení serveru a záloha databáze před změnou souborů…
english.Upgrading=Upgrade %1 → %2: stopping the server and backing up the database before replacing files…

[Types]
Name: "full"; Description: "{cm:TypeFull}"
Name: "local"; Description: "{cm:TypeLocal}"

[Components]
Name: "app"; Description: "{cm:CompLocal}"; Types: full local; Flags: fixed
Name: "server"; Description: "{cm:CompServer}"; Types: full

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:Shortcuts}"
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:ServerGroup}"; Components: server
Name: "firewall"; Description: "{cm:TaskFirewall}"; GroupDescription: "{cm:ServerGroup}"; Components: server; Flags: unchecked

[Dirs]
Name: "{commonappdata}\ResInvestERP"; Components: server; Permissions: users-modify; Flags: uninsneveruninstall

[Files]
; --- program (tryb lokalny; ten sam plik serwuje serwer) ---
Source: "..\ResInvest_ERP.html"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "..\app\assets\icons\ric.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\{#EditionId}\app.config.json"; DestDir: "{app}\config"; Components: app; Flags: ignoreversion
Source: "..\data\sample_data.json"; DestDir: "{app}\data"; Components: app; Flags: ignoreversion
Source: "..\docs\*.md"; DestDir: "{app}\docs"; Components: app; Flags: ignoreversion
Source: "..\tests\resinvest_demo_scenarios.md"; DestDir: "{app}\docs"; Components: app; Flags: ignoreversion
Source: "..\app\assets\fonts\LICENSE-OFL.txt"; DestDir: "{app}\docs"; DestName: "LICENSE-czcionki-OFL.txt"; Components: app; Flags: ignoreversion
; --- serwer: kod, silnik (wspólny z przeglądarką), konfiguracja, środowisko Node.js ---
Source: "..\server\*.mjs"; DestDir: "{app}\server"; Components: server; Flags: ignoreversion
; warstwa bazy danych (SQLite / PostgreSQL), narzędzie migracji i sterownik PostgreSQL (node_modules: npm ci --omit=dev przed budową)
Source: "..\server\db\*.mjs"; DestDir: "{app}\server\db"; Components: server; Flags: ignoreversion
Source: "..\tools\db-migrate.mjs"; DestDir: "{app}\tools"; Components: server; Flags: ignoreversion
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\app\src\*.js"; DestDir: "{app}\app\src"; Components: server; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Components: server; Flags: ignoreversion
Source: "build\{#EditionId}\server.config.json"; DestDir: "{app}\config"; Components: server; Flags: onlyifdoesntexist uninsneveruninstall
; wariant instalacji (domeny kont) — nadpisywany zawsze; server.env administratora ma pierwszeństwo
Source: "build\{#EditionId}\edition.env"; DestDir: "{app}\config"; Components: server; Flags: ignoreversion
Source: "..\.env.example"; DestDir: "{app}\config"; Components: server; Flags: ignoreversion
; plik z kluczem poczty — tylko przy pierwszej instalacji; aktualizacja nie nadpisuje, odinstalowanie nie usuwa
Source: "build\{#EditionId}\server.env"; DestDir: "{commonappdata}\ResInvestERP"; DestName: "server.env"; Components: server; Flags: onlyifdoesntexist uninsneveruninstall
Source: "runtime\node.exe"; DestDir: "{app}\runtime"; Components: server; Flags: ignoreversion
Source: "runtime\LICENSE-node.txt"; DestDir: "{app}\runtime"; Components: server; Flags: ignoreversion skipifsourcedoesntexist
Source: "scripts\*.cmd"; DestDir: "{app}"; Components: server; Flags: ignoreversion

[INI]
Filename: "{app}\ResInvest ERP (serwer).url"; Section: "InternetShortcut"; Key: "URL"; String: "{#AppURL}"; Components: server

[Icons]
Name: "{group}\{cm:LnkLocal}"; Filename: "{app}\ResInvest_ERP.html"; IconFilename: "{app}\ric.ico"; Components: app
Name: "{group}\{cm:LnkServer}"; Filename: "{app}\ResInvestERP-Serwer.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Components: server
Name: "{group}\{cm:LnkOpen}"; Filename: "{app}\ResInvestERP-Otworz.cmd"; Parameters: "{#AppURL}"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Flags: runminimized; Components: server
Name: "{group}\{cm:LnkBackup}"; Filename: "{app}\ResInvestERP-Kopia.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Components: server
Name: "{group}\{cm:LnkCheck}"; Filename: "{app}\ResInvestERP-Kontrola.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Components: server
Name: "{group}\{cm:LnkData}"; Filename: "{commonappdata}\ResInvestERP"; Components: server
Name: "{group}\{cm:LnkEnv}"; Filename: "{sys}\notepad.exe"; Parameters: """{commonappdata}\ResInvestERP\server.env"""; Components: server
Name: "{group}\{cm:LnkDocs}"; Filename: "{app}\README.md"; Components: app
#if EditionShare != ""
; wariant z folderem firmy (udział sieciowy): program dla pracowników i druga kopia bazy; baza zostaje lokalnie
Name: "{group}\{cm:LnkShare}"; Filename: "{#EditionShare}"; Components: server
Name: "{group}\{cm:LnkPublish}"; Filename: "{app}\ResInvestERP-Udzial.cmd"; Parameters: """{#EditionShare}"""; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Components: server
#endif
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{cm:LnkLocal}"; Filename: "{app}\ResInvest_ERP.html"; Tasks: desktopicon; IconFilename: "{app}\ric.ico"; Components: app and not server
Name: "{autodesktop}\{cm:LnkOpen}"; Filename: "{app}\ResInvestERP-Otworz.cmd"; Parameters: "{#AppURL}"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"; Flags: runminimized; Tasks: desktopicon; Components: server
Name: "{commonstartup}\{cm:LnkServer}"; Filename: "{app}\ResInvestERP-Serwer.cmd"; Parameters: "--no-open"; WorkingDir: "{app}"; Flags: runminimized; IconFilename: "{app}\ric.ico"; Tasks: autostart

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""ResInvest ERP Serwer"" dir=in action=allow protocol=TCP localport={#ServerPort} profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "{app}\ResInvestERP-Serwer.cmd"; WorkingDir: "{app}"; Description: "{cm:RunServer}"; Flags: postinstall skipifsilent nowait runminimized; Components: server
Filename: "{app}\ResInvest_ERP.html"; Description: "{cm:RunLocal}"; Flags: shellexec postinstall skipifsilent nowait unchecked; Components: app
#if EditionShare != ""
; publikacja w folderze firmy jako zalogowany użytkownik (dostęp do udziału przez VPN), nie jako administrator instalatora
Filename: "{app}\ResInvestERP-Udzial.cmd"; Parameters: """{#EditionShare}"""; WorkingDir: "{app}"; Description: "{cm:RunPublish,{#EditionShare}}"; Flags: postinstall skipifsilent runasoriginaluser; Components: server
#endif

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""ResInvest ERP Serwer"""; Flags: runhidden; RunOnceId: "fw"; Tasks: firewall
Filename: "{sys}\taskkill.exe"; Parameters: "/F /FI ""WINDOWTITLE eq ResInvest ERP Serwer*"""; Flags: runhidden; RunOnceId: "stop"; Components: server

[InstallDelete]
; 3.13: skrót do server.env ma nową nazwę (poczta ustawiana w programie: Poczta → Konfiguracja poczty)
Type: files; Name: "{group}\Konfiguracja poczty i adresu (server.env).lnk"
Type: files; Name: "{group}\Nastavení pošty a adresy (server.env).lnk"
Type: files; Name: "{group}\E-mail and address settings (server.env).lnk"
; 3.12: skróty z wersji 3.11 z długą kreską w nazwie (zastąpione nazwami z „-”)
Type: files; Name: "{group}\ResInvest ERP Serwer — uruchom.lnk"
Type: files; Name: "{group}\ResInvest ERP (serwer) — otwórz w przeglądarce.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP Serwer — uruchom.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP (serwer) — otwórz w przeglądarce.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP Serwer — uruchom.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP (serwer) — otwórz w przeglądarce.lnk"
Type: files; Name: "{group}\ResInvest ERP Server — spustit.lnk"
Type: files; Name: "{group}\ResInvest ERP (server) — otevřít v prohlížeči.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP Server — spustit.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP (server) — otevřít v prohlížeči.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP Server — spustit.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP (server) — otevřít v prohlížeči.lnk"
Type: files; Name: "{group}\ResInvest ERP Server — start.lnk"
Type: files; Name: "{group}\ResInvest ERP (server) — open in browser.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP Server — start.lnk"
Type: files; Name: "{autodesktop}\ResInvest ERP (server) — open in browser.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP Server — start.lnk"
Type: files; Name: "{commonstartup}\ResInvest ERP (server) — open in browser.lnk"

[UninstallDelete]
Type: files; Name: "{app}\ResInvest ERP (serwer).url"

[Code]
{ Aktualizacja w miejscu (ten sam AppId): dane C:\ProgramData\ResInvestERP, server.env i config\server.config.json
  zostają bez zmian. Przed podmianą plików: blokada instalacji starszej wersji, zatrzymanie serwera, kopia bazy.
  Po pierwszym uruchomieniu nowej wersji serwer sam robi drugą kopię „przed-aktualizacja-<wersja>” i migruje dane. }
const
  UninstKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8C1B7E52-3E0B-4B7A-9E0D-5B2D6A1F4C10}_is1';

function InstalledVersion(): String;
begin
  Result := '';
  if not RegQueryStringValue(HKLM, UninstKey, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKCU, UninstKey, 'DisplayVersion', Result) then Result := '';
end;

{ Porównanie wersji „a.b.c”: wynik < 0, 0, > 0 }
function VersionPart(var S: String): Integer;
var P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then begin Result := StrToIntDef(S, 0); S := ''; end
  else begin Result := StrToIntDef(Copy(S, 1, P - 1), 0); Delete(S, 1, P); end;
end;

function CompareVersions(A, B: String): Integer;
var I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 4 do begin
    X := VersionPart(A); Y := VersionPart(B);
    if X <> Y then begin Result := X - Y; Exit; end;
  end;
end;

function InitializeSetup(): Boolean;
var Old: String;
begin
  Result := True;
  Old := InstalledVersion();
  if (Old <> '') and (CompareVersions(Old, '{#AppVersion}') > 0) and (ExpandConstant('{param:ALLOWDOWNGRADE|0}') <> '1') then begin
    SuppressibleMsgBox(FmtMessage(CustomMessage('Downgrade'), [Old, '{#AppVersion}']), mbCriticalError, MB_OK, IDOK);
    Result := False;
  end;
end;

function EnvFile(): String;
begin
  Result := ExpandConstant('{commonappdata}\ResInvestERP\server.env');
end;

{ Wartość KEY= z istniejącego server.env (bez cudzysłowów); pusty napis, gdy brak pliku albo klucza }
function EnvValue(Key: String): String;
var Lines: TArrayOfString; I: Integer; L: String;
begin
  Result := '';
  if not LoadStringsFromFile(EnvFile(), Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do begin
    L := Trim(Lines[I]);
    if Pos(Key + '=', L) = 1 then begin
      Result := Trim(Copy(L, Length(Key) + 2, 10000));
      if (Length(Result) >= 2) and ((Result[1] = '"') or (Result[1] = #39)) then Result := Copy(Result, 2, Length(Result) - 2);
      Exit;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Old, Node, Srv, Data: String; Code: Integer;
begin
  Result := '';
  Old := InstalledVersion();
  if Old = '' then Exit;
  WizardForm.PreparingLabel.Caption := FmtMessage(CustomMessage('Upgrading'), [Old, '{#AppVersion}']);
  { serwer uruchomiony skrótem ma tytuł okna „ResInvest ERP Serwer” }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /FI "WINDOWTITLE eq ResInvest ERP Serwer*"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(1500);
  Node := ExpandConstant('{app}\runtime\node.exe');
  Srv := ExpandConstant('{app}\server\riw-server.mjs');
  Data := ExpandConstant('{commonappdata}\ResInvestERP');
  { kopia bazy przed aktualizacją: SQLite albo PostgreSQL (DB_DRIVER=postgres w server.env) }
  if FileExists(Node) and FileExists(Srv) and (FileExists(Data + '\resinvest.sqlite') or (Lowercase(EnvValue('DB_DRIVER')) = 'postgres')) then
    Exec(Node, '--disable-warning=ExperimentalWarning "' + Srv + '" --data "' + Data + '" --backup-now', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ ===================== 3.13: strona „Poczta” kreatora ===================== }
var
  MailPage: TInputQueryWizardPage;
  DbPage: TInputQueryWizardPage;
  DbSqlite: TNewCheckBox;

function JsonEsc(S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

{ ===================== 3.14: kreator na pełnym ekranie ===================== }
function GetSystemMetrics(nIndex: Integer): Integer;
  external 'GetSystemMetrics@user32.dll stdcall';
function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: LongWord): LongWord;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, uIDEvent: LongWord): BOOL;
  external 'KillTimer@user32.dll stdcall';

var
  FullScreenTimer: LongWord;

{ Wywoływane przez timer, aż okno kreatora będzie widoczne (Inno Setup ustala rozmiar okna dopiero przy pokazaniu):
  najpierw okno na cały obszar roboczy ekranu (bez paska zadań), potem maksymalizacja. Kreator jest skalowalny
  (WizardResizable) — strony, listy i pola rozciągają się na cały ekran. }
procedure FullScreenTick(Wnd: LongWord; Msg: LongWord; IdEvent: LongWord; Time: LongWord);
var W, H: Integer;
begin
  if not WizardForm.Visible then Exit;
  KillTimer(0, FullScreenTimer); FullScreenTimer := 0;
  { Inno Setup ogranicza skalowalne okno do 150% rozmiaru bazowego — bez limitu okno wypełnia cały ekran }
  WizardForm.Constraints.MaxWidth := 0; WizardForm.Constraints.MaxHeight := 0;
  W := GetSystemMetrics(16);                              { SM_CXFULLSCREEN: szerokość obszaru roboczego }
  H := GetSystemMetrics(17) + GetSystemMetrics(4);        { SM_CYFULLSCREEN + SM_CYCAPTION: wysokość obszaru roboczego }
  if (W > WizardForm.Width) and (H > WizardForm.Height) then begin
    WizardForm.Left := 0; WizardForm.Top := 0;
    WizardForm.Width := W; WizardForm.Height := H;
  end;
  SendMessage(WizardForm.Handle, $0112, $F030, 0);        { WM_SYSCOMMAND, SC_MAXIMIZE }
end;

procedure FullScreenWizard();
begin
  FullScreenTimer := SetTimer(0, 0, 40, CreateCallback(@FullScreenTick));
end;

procedure InitializeWizard();
var V: String;
begin
  FullScreenWizard();
  { 3.15: strona „Baza danych” — przed stroną „Poczta” }
  DbPage := CreateInputQueryPage(wpSelectTasks, CustomMessage('DbTitle'), CustomMessage('DbSub'), CustomMessage('DbDesc'));
  DbPage.Add(CustomMessage('DbHost'), False);
  DbPage.Add(CustomMessage('DbPort'), False);
  DbPage.Add(CustomMessage('DbName'), False);
  DbPage.Add(CustomMessage('DbUser'), False);
  DbPage.Add(CustomMessage('DbPass'), True);
  DbPage.Add(CustomMessage('DbAdmin'), False);
  DbPage.Add(CustomMessage('DbAdminPass'), True);
  DbPage.SubCaptionLabel.Anchors := [akLeft, akTop, akRight];
  V := EnvValue('DB_HOST'); if V = '' then V := '127.0.0.1'; DbPage.Values[0] := V;
  V := EnvValue('DB_PORT'); if V = '' then V := '5432'; DbPage.Values[1] := V;
  V := EnvValue('DB_NAME'); if V = '' then V := 'resinvest'; DbPage.Values[2] := V;
  V := EnvValue('DB_USER'); if V = '' then V := 'resinvest_app'; DbPage.Values[3] := V;
  DbPage.Values[5] := 'postgres';
  DbSqlite := TNewCheckBox.Create(DbPage);
  DbSqlite.Parent := DbPage.Surface;
  DbSqlite.Left := DbPage.Edits[6].Left;
  DbSqlite.Top := DbPage.Edits[6].Top + DbPage.Edits[6].Height + ScaleY(14);
  DbSqlite.Width := DbPage.SurfaceWidth - DbSqlite.Left;
  DbSqlite.Height := ScaleY(20);
  DbSqlite.Anchors := [akLeft, akTop, akRight];
  DbSqlite.Caption := CustomMessage('DbSqlite');
  DbSqlite.Checked := False;
  MailPage := CreateInputQueryPage(DbPage.ID, CustomMessage('MailTitle'), CustomMessage('MailSub'), CustomMessage('MailDesc'));
  MailPage.Add(CustomMessage('MailHost'), False);
  MailPage.Add(CustomMessage('MailPort'), False);
  MailPage.Add(CustomMessage('MailUser'), False);
  MailPage.Add(CustomMessage('MailPass'), True);
  MailPage.Add(CustomMessage('MailApp'), False);
  { opis nad polami rozciąga się razem z oknem (kreator na pełnym ekranie) }
  MailPage.SubCaptionLabel.Anchors := [akLeft, akTop, akRight];
  { wartości z wariantu instalacji; przy aktualizacji — z istniejącego server.env }
  V := EnvValue('SMTP_HOST'); if V = '' then V := '{#EditionSmtpHost}'; MailPage.Values[0] := V;
  V := EnvValue('SMTP_PORT'); if V = '' then V := '{#EditionSmtpPort}'; MailPage.Values[1] := V;
  V := EnvValue('SMTP_USER'); if V = '' then V := '{#EditionSmtpUser}'; MailPage.Values[2] := V;
  V := EnvValue('APP_URL'); if V = '' then V := 'http://' + Lowercase(GetComputerNameString()) + ':{#ServerPort}'; MailPage.Values[4] := V;
end;

{ Strona tylko dla serwera i tylko wtedy, gdy poczta nie jest jeszcze ustawiona (aktualizacja jej nie zmienia) }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (MailPage <> nil) and (PageID = MailPage.ID) then
    Result := (not WizardIsComponentSelected('server')) or (EnvValue('SMTP_PASS') <> '');
  { strona „Baza danych” tylko dla serwera i tylko wtedy, gdy serwer nie pracuje jeszcze na PostgreSQL }
  if (DbPage <> nil) and (PageID = DbPage.ID) then
    Result := (not WizardIsComponentSelected('server')) or (Lowercase(EnvValue('DB_DRIVER')) = 'postgres');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (DbPage <> nil) and (CurPageID = DbPage.ID) and (not DbSqlite.Checked) then
    if (Trim(DbPage.Values[0]) = '') or ((DbPage.Values[4] = '') and (DbPage.Values[6] = '')) then begin
      MsgBox(CustomMessage('DbNeed'), mbError, MB_OK);
      Result := False;
      Exit;
    end;
  if (MailPage <> nil) and (CurPageID = MailPage.ID) and (MailPage.Values[3] <> '') then
    if (Trim(MailPage.Values[0]) = '') or (Pos('@', MailPage.Values[2]) = 0) then begin
      MsgBox(CustomMessage('MailNeedUser'), mbError, MB_OK);
      Result := False;
    end;
end;

{ 3.15: po skopiowaniu plików — konto i baza programu, połączenie, server.env i przeniesienie danych z SQLite
  (serwer: --db-setup). Hasła trafiają do pliku w folderze tymczasowym instalatora (usuwany od razu),
  nie do wiersza poleceń. Każdy błąd zostawia serwer na dotychczasowej bazie. }
procedure SaveDbSettings();
var J, R: TArrayOfString; F, Res, Node, Srv, Data, Msg, Mode: String; Code, I: Integer;
begin
  if (DbPage = nil) or WizardSilent() or (not WizardIsComponentSelected('server')) then Exit;
  if Lowercase(EnvValue('DB_DRIVER')) = 'postgres' then Exit;
  Node := ExpandConstant('{app}\runtime\node.exe');
  Srv := ExpandConstant('{app}\server\riw-server.mjs');
  Data := ExpandConstant('{commonappdata}\ResInvestERP');
  F := ExpandConstant('{tmp}\db-setup.json');
  Res := ExpandConstant('{tmp}\db-setup.txt');
  if DbSqlite.Checked then Mode := 'sqlite' else Mode := 'postgres';
  SetArrayLength(J, 1);
  J[0] := '{"mode":"' + Mode + '","host":"' + JsonEsc(Trim(DbPage.Values[0])) + '","port":"' + JsonEsc(Trim(DbPage.Values[1])) +
    '","database":"' + JsonEsc(Trim(DbPage.Values[2])) + '","user":"' + JsonEsc(Trim(DbPage.Values[3])) + '","password":"' + JsonEsc(DbPage.Values[4]) +
    '","adminUser":"' + JsonEsc(Trim(DbPage.Values[5])) + '","adminPassword":"' + JsonEsc(DbPage.Values[6]) + '","resultFile":"' + JsonEsc(Res) + '"}';
  SaveStringsToUTF8File(F, J, False);
  WizardForm.StatusLabel.Caption := CustomMessage('DbBusy');
  Exec(Node, '--disable-warning=ExperimentalWarning "' + Srv + '" --data "' + Data + '" --db-setup "' + F + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
  DeleteFile(F);
  Msg := '';
  if LoadStringsFromFile(Res, R) then
    for I := 0 to GetArrayLength(R) - 1 do Msg := Msg + R[I] + #13#10;
  DeleteFile(Res);
  if Code = 0 then MsgBox(Msg, mbInformation, MB_OK)
  else MsgBox(Msg + #13#10 + CustomMessage('DbFailed'), mbError, MB_OK);
end;

{ Po skopiowaniu plików: zapis do server.env przez serwer (--mail-setup) i wiadomość testowa na adres skrzynki.
  Hasło trafia do pliku w folderze tymczasowym instalatora (usuwany od razu), nie do wiersza poleceń. }
procedure SaveMailSettings();
var J, R: TArrayOfString; F, Res, Node, Srv, Data, Msg: String; Code, I: Integer;
begin
  if (MailPage = nil) or WizardSilent() or (not WizardIsComponentSelected('server')) then Exit;
  if (MailPage.Values[3] = '') then Exit;
  Node := ExpandConstant('{app}\runtime\node.exe');
  Srv := ExpandConstant('{app}\server\riw-server.mjs');
  Data := ExpandConstant('{commonappdata}\ResInvestERP');
  F := ExpandConstant('{tmp}\mail-setup.json');
  Res := ExpandConstant('{tmp}\mail-setup.txt');
  SetArrayLength(J, 1);
  J[0] := '{"host":"' + JsonEsc(Trim(MailPage.Values[0])) + '","port":"' + JsonEsc(Trim(MailPage.Values[1])) + '","user":"' + JsonEsc(Trim(MailPage.Values[2])) +
    '","pass":"' + JsonEsc(MailPage.Values[3]) + '","appUrl":"' + JsonEsc(Trim(MailPage.Values[4])) + '","test":true,"resultFile":"' + JsonEsc(Res) + '"}';
  SaveStringsToUTF8File(F, J, False);
  WizardForm.StatusLabel.Caption := CustomMessage('MailBusy');
  Exec(Node, '--disable-warning=ExperimentalWarning "' + Srv + '" --data "' + Data + '" --mail-setup "' + F + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
  DeleteFile(F);
  Msg := '';
  if LoadStringsFromFile(Res, R) then
    for I := 0 to GetArrayLength(R) - 1 do Msg := Msg + R[I] + #13#10;
  DeleteFile(Res);
  Msg := Msg + #13#10 + CustomMessage('MailLater');
  if Code = 0 then MsgBox(Msg, mbInformation, MB_OK) else MsgBox(Msg, mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    SaveDbSettings();
    SaveMailSettings();
  end;
end;

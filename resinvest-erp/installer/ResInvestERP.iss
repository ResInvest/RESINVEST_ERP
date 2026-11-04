; =========================================================================
;  ResInvest ERP 3.12 · instalator Windows (Inno Setup 7; zgodny z Inno Setup 6.3+)
;  Kodowanie pliku: UTF-8 z BOM (wymagane dla polskich i czeskich znaków — Inno Setup 7
;  przerywa kompilację przy bajtach niezgodnych ze stroną kodową pliku).
;
;  Budowanie (Windows, z katalogu resinvest-erp):
;    powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
;  Skrypt: buduje ResInvest_ERP.html, generuje dane przykładowe, pobiera
;  środowisko Node.js (node.exe, weryfikacja SHA-256) do installer\runtime
;  i kompiluje ten plik dla każdego wariantu (/DEditionId=firma|gmail|otwarta).
;  Wynik: installer\Output\ResInvestERP_Serwer_Setup_3.12.0_<Wariant>.exe
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
;   * Serwer (wielostanowiskowy) — ResInvest ERP Serwer: Node.js + SQLite,
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
#define AppVersion "3.12.0"
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
OutputBaseFilename=ResInvestERP_Serwer_Setup_{#AppVersion}_{#EditionSuffix}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
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
polish.FinishedLabel=Instalacja zakończona. Po kliknięciu „Zakończ” serwer uruchomi się i otworzy program (http://localhost:8080).%n%nPierwsze logowanie:%n   e-mail:  {#EditionAdmin}%n   hasło:  {#EditionAdminPassword}%nProgram poprosi o ustawienie własnego hasła.%n%nInne komputery w sieci: http://<adres tego komputera>:8080
czech.FinishedLabel=Instalace dokončena. Po kliknutí na „Dokončit“ se spustí server a otevře program (http://localhost:8080).%n%nPrvní přihlášení:%n   e-mail:  {#EditionAdmin}%n   heslo:  {#EditionAdminPassword}%nProgram vás požádá o nastavení vlastního hesla.
english.FinishedLabel=Setup is complete. After you click Finish the server starts and opens the program (http://localhost:8080).%n%nFirst sign-in:%n   e-mail:  {#EditionAdmin}%n   password:  {#EditionAdminPassword}%nYou will be asked to set your own password.
#else
polish.FinishedLabel=Instalacja zakończona. Po kliknięciu „Zakończ” serwer uruchomi się i otworzy program (http://localhost:8080).%n%nPierwsze uruchomienie: utwórz konto administratora (adres {#EditionDomains}) na ekranie, który się pojawi.
czech.FinishedLabel=Instalace dokončena. Po kliknutí na „Dokončit“ se spustí server a otevře program (http://localhost:8080).%n%nPrvní spuštění: vytvořte účet administrátora (adresa {#EditionDomains}).
english.FinishedLabel=Setup is complete. After you click Finish the server starts and opens the program (http://localhost:8080).%n%nFirst start: create the administrator account ({#EditionDomains}) on the screen that appears.
#endif

[CustomMessages]
polish.CompLocal=Program — tryb lokalny (jedno stanowisko)
czech.CompLocal=Program — místní režim (jedno pracoviště)
english.CompLocal=Program — local mode (single workstation)
polish.CompServer=Serwer wielostanowiskowy (Node.js + SQLite)
czech.CompServer=Víceuživatelský server (Node.js + SQLite)
english.CompServer=Multi-user server (Node.js + SQLite)
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
polish.LnkEnv=Konfiguracja poczty i adresu (server.env)
czech.LnkEnv=Nastavení pošty a adresy (server.env)
english.LnkEnv=E-mail and address settings (server.env)
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
  if FileExists(Node) and FileExists(Srv) and FileExists(Data + '\resinvest.sqlite') then
    Exec(Node, '--disable-warning=ExperimentalWarning "' + Srv + '" --data "' + Data + '" --backup-now', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
end;

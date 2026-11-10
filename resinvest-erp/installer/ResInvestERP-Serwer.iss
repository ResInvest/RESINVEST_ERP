; =========================================================================
;  ResInvest ERP Serwer — instalator Windows (Inno Setup 6.4+), wydanie z obsługą PostgreSQL.
;
;  Budowanie (na komputerze z Windows):
;    1. npm ci --omit=dev                      (sterownik pg trafia do node_modules)
;    2. skopiuj node.exe (Node.js 22.13+ x64) do runtime\node.exe
;    3. ISCC.exe installer\ResInvestERP-Serwer.iss      → dist\ResInvestERP_SerwerFirma_Setup.exe
;
;  Ten sam AppId co wydanie 3.14 — instalacja jest AKTUALIZACJĄ istniejącego programu:
;  dane w C:\ProgramData\ResInvestERP (baza SQLite, kopie, server.env) nie są ruszane.
;  Instalator NIE przełącza bazy na PostgreSQL i NIE uruchamia migracji — to osobna, świadoma
;  czynność administratora (docs\POSTGRESQL.md, ResInvestERP-Migracja.cmd).
;
;  Uwaga: kreator poczty (strona konfiguracji SMTP) z instalatora 3.14 nie jest częścią tego skryptu —
;  jego kod źródłowy nie znajduje się w repozytorium. Pocztę ustawia się w programie
;  (Poczta → Konfiguracja poczty) albo w server.env.
; =========================================================================
#define AppName "ResInvest ERP"
#define AppVersion "3.14.0"
#define AppPublisher "ResInvest Commodities"

[Setup]
AppId={{8C1B7E52-3E0B-4B7A-9E0D-5B2D6A1F4C10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} Serwer {#AppVersion} (Firma — PostgreSQL)
AppPublisher={#AppPublisher}
AppCopyright=Copyright (c) 2026 Mateusz Roesner — program stworzony dla ResInvest Commodities
DefaultDirName={autopf}\ResInvest ERP
DefaultGroupName=ResInvest ERP
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
SetupIconFile=..\ric.ico
UninstallDisplayIcon={app}\ric.ico
OutputDir=..\dist
OutputBaseFilename=ResInvestERP_SerwerFirma_Setup
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Dirs]
; dane poza katalogiem programu — przetrwają aktualizację i odinstalowanie
Name: "{commonappdata}\ResInvestERP"; Flags: uninsneveruninstall

[Files]
Source: "..\ResInvest_ERP.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\ric.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config\app.config.json"; DestDir: "{app}\config"; Flags: ignoreversion
Source: "..\config\server.config.json"; DestDir: "{app}\config"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\config\edition.env"; DestDir: "{app}\config"; Flags: ignoreversion
Source: "..\config\.env.example"; DestDir: "{app}\config"; Flags: ignoreversion
; server.env tworzony tylko przy pierwszej instalacji — ustawienia administratora (poczta, baza) nie są nadpisywane
Source: "..\config\server.env.windows-template"; DestDir: "{commonappdata}\ResInvestERP"; DestName: "server.env"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\data\sample_data.json"; DestDir: "{app}\data"; Flags: ignoreversion
Source: "..\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs
Source: "..\app\src\*.js"; DestDir: "{app}\app\src"; Flags: ignoreversion
Source: "..\server\*.mjs"; DestDir: "{app}\server"; Flags: ignoreversion
Source: "..\server\db\*.mjs"; DestDir: "{app}\server\db"; Flags: ignoreversion
Source: "..\tools\db-migrate.mjs"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "..\tools\bench-db.mjs"; DestDir: "{app}\tools"; Flags: ignoreversion
; sterownik PostgreSQL (czysty JavaScript, bez kompilacji)
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\runtime\LICENSE-node.txt"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\ResInvestERP-*.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\ResInvest ERP"; Filename: "{app}\ResInvestERP-Otworz.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"
Name: "{group}\ResInvest ERP Serwer"; Filename: "{app}\ResInvestERP-Serwer.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"
Name: "{group}\Kopia zapasowa teraz"; Filename: "{app}\ResInvestERP-Kopia.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"
Name: "{group}\Kontrola spójności bazy"; Filename: "{app}\ResInvestERP-Kontrola.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"
Name: "{group}\Migracja bazy (PostgreSQL) — plan"; Filename: "{app}\ResInvestERP-Migracja.cmd"; Parameters: "plan"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"
Name: "{group}\Instrukcja PostgreSQL"; Filename: "{app}\docs\POSTGRESQL.md"
Name: "{commondesktop}\ResInvest ERP"; Filename: "{app}\ResInvestERP-Otworz.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\ric.ico"

[Run]
; przed zmianą plików: kopia bazy (działa na SQLite i na PostgreSQL); błąd kopii nie przerywa instalacji nowej, pustej bazy
Filename: "{app}\runtime\node.exe"; Parameters: "--disable-warning=ExperimentalWarning ""{app}\server\riw-server.mjs"" --data ""{commonappdata}\ResInvestERP"" --backup-now"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; StatusMsg: "Kopia zapasowa bazy…"; Check: FileExists(ExpandConstant('{commonappdata}\ResInvestERP\resinvest.sqlite'))
Filename: "{app}\ResInvestERP-Serwer.cmd"; Description: "Uruchom serwer ResInvest ERP"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /FI ""WINDOWTITLE eq ResInvest ERP Serwer*"""; Flags: runhidden; RunOnceId: "StopServer"

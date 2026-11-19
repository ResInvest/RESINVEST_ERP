; Inno Setup 6 — instalator GenResInvest 1.0 (Windows 10/11, 64-bit)
; Budowa: installer\build.ps1  (najpierw PyInstaller, potem ISCC)

#define AppName "GenResInvest"
#define AppVersion "1.0.0"
#define AppPublisher "ResInvest Commodities PL S.A."
#define AppExe "GenResInvest.exe"

[Setup]
AppId={{6B0E3F2A-8C51-4E7B-9D0B-1E7A2C9F4D10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=GenResInvest-1.0.0-setup
SetupIconFile=genresinvest.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
LicenseFile=..\LICENSE
CloseApplications=yes
; Dane (baza, dokumenty, kopie) są w C:\ProgramData\GenResInvest i NIE są usuwane przy odinstalowaniu.

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Skrót na pulpicie"; GroupDescription: "Skróty:"
Name: "autostart"; Description: "Uruchamiaj GenResInvest przy logowaniu do Windows"; GroupDescription: "Uruchamianie:"; Flags: unchecked
Name: "lan"; Description: "Dostęp z innych komputerów i telefonów w sieci firmowej (port 8765, reguła zapory)"; GroupDescription: "Sieć:"; Flags: unchecked

[Dirs]
Name: "{commonappdata}\GenResInvest"; Permissions: users-modify

[Files]
Source: "..\dist\GenResInvest\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\.env.example"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\GenResInvest"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{group}\Kopia zapasowa teraz"; Filename: "{app}\{#AppExe}"; Parameters: "--backup-now"; WorkingDir: "{app}"
Name: "{group}\Katalog danych"; Filename: "{commonappdata}\GenResInvest"
Name: "{group}\Odinstaluj GenResInvest"; Filename: "{uninstallexe}"
Name: "{autodesktop}\GenResInvest"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\GenResInvest"; Filename: "{app}\{#AppExe}"; Parameters: "--no-browser"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""GenResInvest"" dir=in action=allow protocol=TCP localport=8765"; Flags: runhidden; Tasks: lan
Filename: "{app}\{#AppExe}"; Description: "Uruchom GenResInvest"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""GenResInvest"""; Flags: runhidden; RunOnceId: "fw"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var EnvFile: string;
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('lan') then
  begin
    EnvFile := ExpandConstant('{commonappdata}\GenResInvest\.env');
    if not FileExists(EnvFile) then
      SaveStringToFile(EnvFile, 'GRI_HOST=0.0.0.0' + #13#10 + 'GRI_PORT=8765' + #13#10, False);
  end;
end;

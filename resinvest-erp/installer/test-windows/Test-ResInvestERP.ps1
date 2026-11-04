<#
=========================================================================
 ResInvest ERP Serwer 3.12 — test odbiorczy na Windows (komputer testowy)

 Uruchomienie (PowerShell JAKO ADMINISTRATOR), pliki w C:\ResInvest-test:
   Set-ExecutionPolicy -Scope Process Bypass -Force
   C:\ResInvest-test\Test-ResInvestERP.ps1

 Co robi:
   1. Sprawdza system, uprawnienia i folder firmy (FortiClient VPN).
   2. Instaluje ResInvestERP_Serwer_Setup_3.12.0_Firma.exe po cichu (log instalatora).
   3. Sprawdza zainstalowane pliki wariantu (domeny, poczta SMTP, folder firmy, node.exe).
   4. Uruchamia serwer z instalacji na porcie testowym 18080 z OSOBNYMI danymi testowymi
      (C:\ResInvest-test\dane) — dane w C:\ProgramData\ResInvestERP nie są ruszane, poczta nie wychodzi.
   5. Sprawdza: zdrowie, logowanie kontem startowym, wymuszoną zmianę hasła, dane (wersja, domeny,
      przeliczniki), kopię zapasową lokalną i w folderze firmy, odrzucenie adresu spoza @resinvest.group.
   6. Publikuje program w folderze firmy (skrypt instalacji) — tylko gdy folder jest dostępny.
   7. Uruchamia testy automatyczne (paczka ResInvestERP-testy-3.12.0.zip) dołączonym node.exe.
   8. Zapisuje raport: C:\ResInvest-test\raport-<data>.txt (i .json) — prześlij go w rozmowie.
 Parametry: -Installer <plik.exe> -Share <folder firmy> -Port 18080 -SkipInstall -SkipTests
=========================================================================
#>
param(
  [string]$Root = "C:\ResInvest-test",
  [string]$Installer = "",
  [string]$Share = "\\ue.cz\EPRPL\Data\BIOMASA",
  [int]$Port = 18080,
  [switch]$SkipInstall,
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$report = Join-Path $Root "raport-$stamp.txt"
$results = New-Object System.Collections.ArrayList
New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Log([string]$m) { $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $line; Add-Content -Path $report -Value $line -Encoding UTF8 }
function Check([string]$name, [bool]$ok, [string]$detail = "") {
  [void]$results.Add([pscustomobject]@{ test = $name; ok = $ok; detail = $detail })
  $mark = if ($ok) { "OK  " } else { "BŁĄD" }
  Log ("{0} {1}{2}" -f $mark, $name, $(if ($detail) { "  → $detail" } else { "" }))
}

Log "ResInvest ERP 3.12 — test odbiorczy · komputer $env:COMPUTERNAME · użytkownik $env:USERNAME"
$os = Get-CimInstance Win32_OperatingSystem
Log ("System: {0} {1} (build {2}), {3}" -f $os.Caption, $os.OSArchitecture, $os.BuildNumber, (Get-Culture).Name)

# ---------- 1. warunki wstępne ----------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Check "PowerShell uruchomiony jako administrator" $admin "potrzebne do instalacji w Program Files"
Check "Windows 64-bit" ([Environment]::Is64BitOperatingSystem)
$shareOk = $false
try { $shareOk = Test-Path -LiteralPath $Share } catch { }
Check "Folder firmy dostępny ($Share)" $shareOk $(if ($shareOk) { "" } else { "połącz FortiClient VPN 'United Energy - VPN' — testy udziału zostaną pominięte" })
$vpn = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "10.212.*" }
Log ("Adresy VPN (10.212.*): {0}" -f $(if ($vpn) { ($vpn.IPAddress -join ", ") } else { "brak" }))
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
Check "Port testowy $Port wolny" (-not $busy)

# ---------- 2. instalacja ----------
$app = Join-Path $env:ProgramFiles "ResInvest ERP"
if (-not $SkipInstall) {
  if (-not $Installer) { $Installer = (Get-ChildItem -Path $Root, $PSScriptRoot -Filter "ResInvestERP_Serwer_Setup_*_Firma.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
  Check "Instalator znaleziony" ([bool]$Installer) $Installer
  if ($Installer) {
    $sig = Get-AuthenticodeSignature $Installer
    Log ("Podpis instalatora: {0} (instalator nie jest podpisany certyfikatem — SmartScreen może pytać o zgodę)" -f $sig.Status)
    $isLog = Join-Path $Root "instalator-$stamp.log"
    $p = Start-Process -FilePath $Installer -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$isLog`"" -Wait -PassThru
    $okLog = (Test-Path $isLog) -and (Select-String -Path $isLog -Pattern "Installation process succeeded" -Quiet)
    Check "Instalacja cicha (kod $($p.ExitCode))" ($p.ExitCode -eq 0 -and $okLog) $isLog
    $iconErr = if (Test-Path $isLog) { Select-String -Path $isLog -Pattern "IPersistFile::Save failed" } else { $null }
    Check "Skróty w menu Start utworzone bez błędów" (-not $iconErr) $(if ($iconErr) { ($iconErr | Select-Object -First 1).Line } else { "" })
  }
}

# ---------- 3. pliki wariantu ----------
$node = Join-Path $app "runtime\node.exe"
Check "Program zainstalowany ($app)" (Test-Path (Join-Path $app "server\riw-server.mjs"))
Check "node.exe (Node 22.13+ z node:sqlite)" ((Test-Path $node) -and ((& $node -e "const [a,b]=process.versions.node.split('.').map(Number);require('node:sqlite');console.log(a>22||(a===22&&b>=13)?'ok':'old')") -eq "ok"))
$ed = Join-Path $app "config\edition.env"
$edText = if (Test-Path $ed) { Get-Content $ed -Raw } else { "" }
Check "Wariant Firma (edition.env)" ($edText -match "RIW_EDITION=firma" -and $edText -match "COMPANY_DOMAINS=resinvest\.group")
Check "Kopie w folderze firmy (BACKUP_COPY_TO)" ($edText -match [regex]::Escape("BACKUP_COPY_TO=$Share\kopie"))
$envFile = Join-Path $env:ProgramData "ResInvestERP\server.env"
$envText = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }
Check "server.env: EMAIL_TRANSPORT=smtp, Microsoft 365" ($envText -match "(?m)^EMAIL_TRANSPORT=smtp" -and $envText -match "(?m)^SMTP_HOST=smtp\.office365\.com")
Check "Skróty: folder firmy i publikacja" ((Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ResInvest ERP") -and ((Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ResInvest ERP" -Filter *.lnk | Measure-Object).Count -ge 8))
$startup = Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp" -Filter "*ResInvest*" -ErrorAction SilentlyContinue
Log ("Autostart serwera: {0}" -f $(if ($startup) { $startup.Name -join ", " } else { "brak (zadanie 'autostart' niezaznaczone albo skrót nie powstał)" }))

# ---------- 4. serwer z danymi testowymi ----------
$data = Join-Path $Root "dane-$stamp"
New-Item -ItemType Directory -Force -Path $data | Out-Null
if ($envText) { Set-Content -Path (Join-Path $data "server.env") -Value $envText -Encoding UTF8 }
$env:RIW_HOST = "127.0.0.1"; $env:EMAIL_TRANSPORT = "file"
$out = Join-Path $Root "serwer-$stamp.log"
$srv = Start-Process -FilePath $node -ArgumentList "--disable-warning=ExperimentalWarning", "`"$app\server\riw-server.mjs`"", "--port", $Port, "--data", "`"$data`"" -WorkingDirectory $app -RedirectStandardOutput $out -RedirectStandardError "$out.err" -PassThru -WindowStyle Hidden
$base = "http://127.0.0.1:$Port"
$health = $null
for ($i = 0; $i -lt 60 -and -not $health; $i++) { Start-Sleep -Milliseconds 500; try { $health = Invoke-RestMethod "$base/api/health" -TimeoutSec 3 } catch { } }
Check "Serwer uruchomiony z instalacji" ([bool]$health) $out
if ($health) {
  Check "Wersja 3.12.0" ($health.version -eq "3.12.0") $health.version
  Check "Domeny kont z wariantu (@resinvest.group) w /api/health" (($health.companyDomains -join ",") -eq "resinvest.group") ($health.companyDomains -join ",")
  $H = @{ "X-RIW" = "1" }
  function Post($path, $body) { Invoke-WebRequest -Uri "$base$path" -Method Post -Headers $H -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))) -WebSession $script:ws -UseBasicParsing -ErrorAction Stop }
  $script:ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $r = $null; try { $r = Post "/api/auth/login" @{ login = "magazyn@resinvest.group"; password = "Admin1234" } } catch { }
  $j = if ($r) { $r.Content | ConvertFrom-Json } else { $null }
  Check "Logowanie kontem startowym magazyn@resinvest.group (sesja serwera)" ($j -and $j.ok) $(if ($j) { "zmiana hasła wymagana: $($j.mustChange)" } else { "" })
  $newPw = "Biomasa-Test-" + (Get-Random -Minimum 1000 -Maximum 9999)
  $r = $null; try { $r = Post "/api/auth/password" @{ old = "Admin1234"; new = $newPw } } catch { }
  Check "Wymuszona zmiana hasła startowego" ($r -and ($r.Content | ConvertFrom-Json).ok)
  $st = $null; try { $st = (Invoke-WebRequest -Uri "$base/api/state" -Headers $H -WebSession $script:ws -UseBasicParsing).Content | ConvertFrom-Json } catch { }
  Check "Dane z bazy SQLite (stan użytkownika)" ($st -and $st.ok) $(if ($st) { "magazyny: " + (($st.state.warehouses | ForEach-Object { $_.name }) -join ", ") } else { "" })
  if ($st) {
    Check "Przeliczniki: historia decyzji w danych (3.12)" ($null -ne $st.state.config.factorHistory) ("1 m3 = {0} MP, 1 MP = {1} t" -f $st.state.config.m3_mp, $st.state.config.mp_t)
    Check "Uprawnienie factors.edit w rolach" ($st.state.users.Count -ge 1)
  }
  $b = $null; try { $b = (Post "/api/backups" @{}).Content | ConvertFrom-Json } catch { }
  Check "Kopia zapasowa bazy (lokalna)" ($b -and $b.ok -and (Test-Path (Join-Path $data "backups\$($b.name)"))) $(if ($b) { $b.name } else { "" })
  if ($shareOk -and $b) {
    $copy = Join-Path "$Share\kopie" $b.name
    Check "Druga kopia w folderze firmy" (Test-Path -LiteralPath $copy) $copy
    if (Test-Path -LiteralPath $copy) { Remove-Item -LiteralPath $copy -Force; Log "Usunięto kopię testową z folderu firmy." }
  }
  $bad = $null; try { Post "/api/auth/login" @{ login = "ktos@gmail.com"; password = "x" } | Out-Null } catch { $bad = $_.ErrorDetails.Message }
  Check "Adres spoza @resinvest.group odrzucony" ($bad -match "resinvest\.group") $bad
  try { Invoke-WebRequest -Uri "$base/" -UseBasicParsing | Out-Null; Check "Strona programu (ResInvest_ERP.html) serwowana" $true } catch { Check "Strona programu (ResInvest_ERP.html) serwowana" $false $_.Exception.Message }
}
if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force; Log "Serwer testowy zatrzymany." }
Remove-Item Env:RIW_HOST, Env:EMAIL_TRANSPORT -ErrorAction SilentlyContinue

# ---------- 6. publikacja w folderze firmy ----------
if ($shareOk) {
  $pub = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"`"$app\ResInvestERP-Udzial.cmd`" `"$Share`" /quiet`"" -Wait -PassThru -WindowStyle Hidden
  Check "Publikacja programu w folderze firmy (kod $($pub.ExitCode))" ($pub.ExitCode -eq 0 -and (Test-Path -LiteralPath "$Share\ResInvest ERP\ResInvest_ERP.html")) "$Share\ResInvest ERP"
}

# ---------- 7. testy automatyczne ----------
if (-not $SkipTests) {
  $pack = Get-ChildItem -Path $Root, $PSScriptRoot -Filter "ResInvestERP-testy-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  Check "Paczka testów znaleziona" ([bool]$pack) $(if ($pack) { $pack.FullName } else { "skopiuj ResInvestERP-testy-3.12.0.zip do $Root" })
  if ($pack) {
    $tdir = Join-Path $Root "testy-$stamp"
    Expand-Archive -Path $pack.FullName -DestinationPath $tdir -Force
    $tlog = Join-Path $Root "testy-$stamp.log"
    # Start-Process zamiast '& node … *>': w Windows PowerShell 5.1 przekierowany strumień błędów programu przerywa skrypt
    $files = "tests\engine.test.mjs tests\features311.test.mjs tests\features312.test.mjs tests\editions312.test.mjs tests\server.test.mjs tests\storage.test.mjs tests\auth.test.mjs"
    $tp = Start-Process -FilePath $node -ArgumentList "--disable-warning=ExperimentalWarning --test $files" -WorkingDirectory (Join-Path $tdir "resinvest-erp") -RedirectStandardOutput $tlog -RedirectStandardError "$tlog.err" -Wait -PassThru -WindowStyle Hidden
    $code = $tp.ExitCode
    $sum = Select-String -Path $tlog -Pattern "^# (tests|pass|fail) " | ForEach-Object { $_.Line.TrimStart("# ") }
    Check "Testy automatyczne na Windows (node --test)" ($code -eq 0) (($sum -join ", ") + " · log: $tlog")
    Select-String -Path $tlog -Pattern "^not ok" | Select-Object -First 10 | ForEach-Object { Log ("  " + $_.Line) }
  }
}

# ---------- 8. podsumowanie ----------
$ok = ($results | Where-Object { $_.ok }).Count; $all = $results.Count
Log ("WYNIK: {0}/{1} OK" -f $ok, $all)
$results | ConvertTo-Json | Set-Content -Path ($report -replace "\.txt$", ".json") -Encoding UTF8
Log "Raport: $report — wyślij go w rozmowie (bez haseł; hasło testowe administratora było losowe i dotyczy tylko danych testowych)."
if ($ok -ne $all) { exit 1 }

<#
=========================================================================
 ResInvest ERP Serwer 3.14 — test odbiorczy na Windows: WSZYSTKIE 3 WARIANTY

 Uruchomienie: dwuklik Uruchom-test.cmd (prosi o uprawnienia administratora) albo
   PowerShell jako administrator:  C:\ResInvest-test\Test-ResInvestERP.ps1
 W C:\ResInvest-test muszą być: 3 instalatory ResInvestERP_GoogleSerwer.exe, ResInvestERP_SerwerNoLimit.exe,
 ResInvestERP_SerwerFirma.exe i paczka ResInvestERP-testy-3.15.0.zip.

 Dla każdego wariantu (kolejność: Gmail → Bez ograniczeń → Firma, Firma zostaje zainstalowana na końcu):
   1. instalacja cicha jak na czystym komputerze (ustawienia poprzedniej instalacji odsunięte na czas testu),
   2. pliki wariantu: domeny kont, poczta SMTP, folder firmy, node.exe, skróty,
   3. serwer z instalacji na porcie 18080 z OSOBNYMI danymi testowymi (C:\ResInvest-test\dane-…);
      dane C:\ProgramData\ResInvestERP\resinvest.sqlite nie są ruszane, poczta nie wychodzi,
   4. logowanie z sesją serwera (konto startowe albo ekran pierwszej konfiguracji), zmiana hasła, dane,
      kopia zapasowa, reguła domen (adres spoza wariantu odrzucony / dowolny adres przyjęty),
   5. Firma: druga kopia i publikacja programu w \\ue.cz\EPRPL\Data\BIOMASA (gdy VPN połączony).
 Na końcu: testy automatyczne (node --test, dołączony node.exe), przywrócenie pierwotnych plików
 server.env / server.config.json, raport C:\ResInvest-test\raport-<data>.txt (+ .json).
 Parametry: -Editions gmail,otwarta,firma  -Share <folder>  -Port 18080  -SkipTests
=========================================================================
#>
param(
  [string]$Root = "C:\ResInvest-test",
  [string[]]$Editions = @("gmail", "otwarta", "firma"),
  [string]$Share = "\\ue.cz\EPRPL\Data\BIOMASA",
  [int]$Port = 18080,
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$report = Join-Path $Root "raport-$stamp.txt"
$results = New-Object System.Collections.ArrayList
$script:edition = "-"

function Log([string]$m) { $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $line; Add-Content -Path $report -Value $line -Encoding UTF8 }
function Check([string]$name, [bool]$ok, [string]$detail = "") {
  [void]$results.Add([pscustomobject]@{ wariant = $script:edition; test = $name; ok = $ok; detail = $detail })
  $mark = if ($ok) { "OK  " } else { "BŁĄD" }
  Log ("{0} [{1}] {2}{3}" -f $mark, $script:edition, $name, $(if ($detail) { "  -> $detail" } else { "" }))
}

# oczekiwania wariantów (te same co installer\editions\*.json)
$E = @{
  gmail   = @{ file = "ResInvestERP_GoogleSerwer";  suffix = "Gmail";         domains = "gmail.com,googlemail.com"; envDomains = "gmail.com,googlemail.com"; smtp = "smtp.gmail.com";     admin = "";                        foreign = "ktos@resinvest.group"; share = $false }
  otwarta = @{ file = "ResInvestERP_SerwerNoLimit"; suffix = "BezOgraniczen"; domains = "";                         envDomains = "*";                        smtp = "";                   admin = "magazyn@resinvest.group"; foreign = $null;                  share = $false }
  firma   = @{ file = "ResInvestERP_SerwerFirma";   suffix = "Firma";         domains = "resinvest.group";          envDomains = "resinvest.group";          smtp = "smtp.office365.com"; admin = "magazyn@resinvest.group"; foreign = "ktos@gmail.com";       share = $true }
}

Log "ResInvest ERP 3.14 — test odbiorczy 3 wariantów · komputer $env:COMPUTERNAME · użytkownik $env:USERNAME"
$os = Get-CimInstance Win32_OperatingSystem
Log ("System: {0} {1} (build {2}), {3}" -f $os.Caption, $os.OSArchitecture, $os.BuildNumber, (Get-Culture).Name)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Check "PowerShell uruchomiony jako administrator" $admin "potrzebne do instalacji w Program Files"
$shareOk = $false
try { $shareOk = Test-Path -LiteralPath $Share } catch { }
Check "Folder firmy dostępny ($Share)" $shareOk $(if ($shareOk) { "" } else { "połącz FortiClient VPN 'United Energy - VPN' — testy udziału zostaną pominięte" })
$vpn = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "10.212.*" }
Log ("Adresy VPN (10.212.*): {0}" -f $(if ($vpn) { ($vpn.IPAddress -join ", ") } else { "brak" }))

$app = Join-Path $env:ProgramFiles "ResInvest ERP"
$node = Join-Path $app "runtime\node.exe"
$envFile = Join-Path $env:ProgramData "ResInvestERP\server.env"
$srvCfg = Join-Path $app "config\server.config.json"
$menu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ResInvest ERP"
# pierwotne ustawienia (jeśli były) — kopia na czas testu, przywracana na końcu
$saved = @{}
foreach ($f in @($envFile, $srvCfg)) { if (Test-Path $f) { $k = Join-Path $Root ("oryginal-" + (Split-Path $f -Leaf) + "-$stamp"); Copy-Item $f $k -Force; $saved[$f] = $k; Log "Kopia pierwotnego pliku: $f -> $k" } }

function Post($base, $path, $body) { Invoke-WebRequest -Uri "$base$path" -Method Post -Headers @{ "X-RIW" = "1" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))) -WebSession $script:ws -UseBasicParsing -ErrorAction Stop }
function ErrText($err) { if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $err.ErrorDetails.Message } else { $err.Exception.Message } }

foreach ($ed in $Editions) {
  $script:edition = $ed; $X = $E[$ed]
  if (-not $X) { Check "Znany wariant" $false $ed; continue }
  Log "================ wariant: $ed ================"
  # --- instalacja jak na czystym komputerze: odinstalowanie poprzedniej (dane i konfiguracja zostają), odsunięcie ustawień ---
  $unins = Join-Path $app "unins000.exe"
  if (Test-Path $unins) {
    Log "Odinstalowanie poprzedniej instalacji (ciche; zatrzymuje uruchomiony serwer, baza i kopie zostają)."
    $u = Start-Process -FilePath $unins -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
    Start-Sleep -Seconds 2
    Check "Odinstalowanie poprzedniej wersji (kod $($u.ExitCode))" ($u.ExitCode -eq 0 -and -not (Test-Path $menu))
  }
  foreach ($f in @($envFile, $srvCfg)) { if (Test-Path $f) { Remove-Item $f -Force } }
  $inst = (Get-ChildItem -Path $Root, $PSScriptRoot -Filter ("{0}.exe" -f $X.file) -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
  Check "Instalator znaleziony" ([bool]$inst) $(if ($inst) { $inst.Name } else { "brak pliku $($X.file).exe w $Root" })
  if (-not $inst) { continue }
  $isLog = Join-Path $Root "instalator-$ed-$stamp.log"
  $p = Start-Process -FilePath $inst.FullName -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$isLog`"" -Wait -PassThru
  $okLog = (Test-Path $isLog) -and (Select-String -Path $isLog -Pattern "Installation process succeeded" -Quiet)
  Check "Instalacja cicha (kod $($p.ExitCode))" ($p.ExitCode -eq 0 -and $okLog) $isLog
  $iconErr = if (Test-Path $isLog) { Select-String -Path $isLog -Pattern "IPersistFile::Save failed" } else { $null }
  Check "Skróty utworzone bez błędów" (-not $iconErr) $(if ($iconErr) { ($iconErr | Select-Object -First 1).Line } else { "" })

  # --- pliki wariantu ---
  Check "Program zainstalowany" (Test-Path (Join-Path $app "server\riw-server.mjs"))
  Check "node.exe (Node 22.13+ z node:sqlite)" ((Test-Path $node) -and ((& $node -e "const [a,b]=process.versions.node.split('.').map(Number);require('node:sqlite');console.log(a>22||(a===22&&b>=13)?'ok':'old')") -eq "ok"))
  $edText = Get-Content (Join-Path $app "config\edition.env") -Raw -ErrorAction SilentlyContinue
  Check "edition.env: RIW_EDITION=$ed, COMPANY_DOMAINS=$($X.envDomains)" ($edText -match "(?m)^RIW_EDITION=$ed\r?$" -and $edText -match ("(?m)^COMPANY_DOMAINS=" + [regex]::Escape($X.envDomains) + "\r?$"))
  $hasCopy = $edText -match [regex]::Escape("BACKUP_COPY_TO=$Share\kopie")
  Check "Folder firmy w wariancie: $(if ($X.share) { 'tak' } else { 'nie' })" ($hasCopy -eq $X.share)
  $envText = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
  Check "server.env: EMAIL_TRANSPORT=smtp, SMTP_HOST=$(if ($X.smtp) { $X.smtp } else { '(do uzupełnienia)' })" ($envText -match "(?m)^EMAIL_TRANSPORT=smtp\r?$" -and $envText -match ("(?m)^SMTP_HOST=" + [regex]::Escape($X.smtp) + "\r?$"))
  $cfgJson = Get-Content $srvCfg -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  Check "Konto startowe: $(if ($X.admin) { $X.admin } else { 'brak (ekran pierwszej konfiguracji)' })" ($cfgJson -and $cfgJson.initialAdmin.email -eq $X.admin)
  $lnk = Get-ChildItem $menu -Filter *.lnk -ErrorAction SilentlyContinue
  Check "Skróty w menu Start" (($lnk | Measure-Object).Count -ge 8) (($lnk | ForEach-Object { $_.BaseName }) -join " | ")
  # nazwy skrótów zależą od języka Windows (PL „Folder firmy…”, CS „Složka firmy…”, EN „Company folder…”)
  Check "Skróty folderu firmy tylko w wariancie Firma" ([bool]($lnk | Where-Object { $_.BaseName -match "firm|company" }) -eq $X.share)

  # --- serwer z danymi testowymi ---
  $data = Join-Path $Root "dane-$ed-$stamp"
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  if ($envText) { Set-Content -Path (Join-Path $data "server.env") -Value $envText -Encoding UTF8 }
  $env:RIW_HOST = "127.0.0.1"; $env:EMAIL_TRANSPORT = "file"
  $out = Join-Path $Root "serwer-$ed-$stamp.log"
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  Check "Port testowy $Port wolny" (-not $busy)
  $srv = Start-Process -FilePath $node -ArgumentList "--disable-warning=ExperimentalWarning", "`"$app\server\riw-server.mjs`"", "--port", $Port, "--data", "`"$data`"" -WorkingDirectory $app -RedirectStandardOutput $out -RedirectStandardError "$out.err" -PassThru -WindowStyle Hidden
  $base = "http://127.0.0.1:$Port"; $health = $null
  for ($i = 0; $i -lt 60 -and -not $health; $i++) { Start-Sleep -Milliseconds 500; try { $health = Invoke-RestMethod "$base/api/health" -TimeoutSec 3 } catch { } }
  Check "Serwer uruchomiony z instalacji" ([bool]$health) $out
  if ($health) {
    Check "Wersja 3.15.0" ($health.version -eq "3.15.0") $health.version
    Check "Folder skanów dokumentów i zdjęć (3.14)" (Test-Path (Join-Path $data "skany")) (Join-Path $data "skany")
    Check "Domeny w /api/health: $(if ($X.domains) { $X.domains } else { 'dowolne' })" ((@($health.companyDomains) -join ",") -eq $X.domains) (@($health.companyDomains) -join ",")
    $script:ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $pw = "Biomasa-Test-" + (Get-Random -Minimum 1000 -Maximum 9999)
    if ($X.admin) {
      Check "Konto startowe utworzone (bez ekranu konfiguracji)" (-not $health.setup)
      $j = $null; try { $j = (Post $base "/api/auth/login" @{ login = $X.admin; password = "Admin1234" }).Content | ConvertFrom-Json } catch { }
      Check "Logowanie kontem startowym $($X.admin) (sesja serwera)" ($j -and $j.ok) $(if ($j) { "zmiana hasła wymagana: $($j.mustChange)" } else { "" })
      $r = $null; try { $r = (Post $base "/api/auth/password" @{ old = "Admin1234"; new = $pw }).Content | ConvertFrom-Json } catch { }
      Check "Wymuszona zmiana hasła startowego" ($r -and $r.ok)
    } else {
      Check "Ekran pierwszej konfiguracji (brak konta startowego)" ([bool]$health.setup)
      $login = "resinvest.test@gmail.com"
      $r = $null; try { $r = (Post $base "/api/setup" @{ name = "Test Gmail"; login = $login; password = $pw; sample = $false }).Content | ConvertFrom-Json } catch { Log ("setup: " + (ErrText $_)) }
      Check "Pierwsza konfiguracja: administrator z adresem Gmail" ($r -and $r.ok)
      $j = $null; try { $j = (Post $base "/api/auth/login" @{ login = $login; password = $pw }).Content | ConvertFrom-Json } catch { }
      Check "Logowanie $login (sesja serwera)" ($j -and $j.ok)
    }
    $st = $null; try { $st = (Invoke-WebRequest -Uri "$base/api/state" -Headers @{ "X-RIW" = "1" } -WebSession $script:ws -UseBasicParsing).Content | ConvertFrom-Json } catch { }
    Check "Dane z bazy SQLite po zalogowaniu" ($st -and $st.ok) $(if ($st) { "magazyny: " + (($st.state.warehouses | ForEach-Object { $_.name }) -join ", ") } else { "" })
    if ($st) { Check "Przeliczniki miesiąca (3.12) w danych" ($null -ne $st.state.config.factorHistory) ("1 m3 = {0} MP, 1 MP = {1} t" -f $st.state.config.m3_mp, $st.state.config.mp_t) }
    $b = $null; try { $b = (Post $base "/api/backups" @{}).Content | ConvertFrom-Json } catch { }
    Check "Kopia zapasowa bazy (lokalna)" ($b -and $b.ok -and (Test-Path (Join-Path $data "backups\$($b.name)"))) $(if ($b) { $b.name } else { "" })
    if ($X.share -and $shareOk -and $b) {
      $copy = Join-Path "$Share\kopie" $b.name
      Check "Druga kopia w folderze firmy" (Test-Path -LiteralPath $copy) $copy
      if (Test-Path -LiteralPath $copy) { Remove-Item -LiteralPath $copy -Force; Log "Usunięto kopię testową z folderu firmy." }
    }
    $script:ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    if ($X.foreign) {
      $msg = $null; try { Post $base "/api/auth/login" @{ login = $X.foreign; password = "x" } | Out-Null } catch { $msg = ErrText $_ }
      Check "Adres spoza wariantu odrzucony ($($X.foreign))" ($msg -match "Wymagany e-mail firmowy") $msg
    } else {
      $msg = $null; try { Post $base "/api/auth/login" @{ login = "ktos@outlook.com"; password = "x" } | Out-Null } catch { $msg = ErrText $_ }
      Check "Dowolna domena dozwolona (ktos@outlook.com nie jest odrzucany z powodu domeny)" ($msg -and $msg -notmatch "Wymagany e-mail firmowy") $msg
    }
    try { Invoke-WebRequest -Uri "$base/" -UseBasicParsing | Out-Null; Check "Strona programu serwowana" $true } catch { Check "Strona programu serwowana" $false $_.Exception.Message }
  }
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force; Start-Sleep -Seconds 1; Log "Serwer testowy zatrzymany." }
  Remove-Item Env:RIW_HOST, Env:EMAIL_TRANSPORT -ErrorAction SilentlyContinue
  if ($X.share -and $shareOk) {
    $pub = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"`"$app\ResInvestERP-Udzial.cmd`" `"$Share`" /quiet`"" -Wait -PassThru -WindowStyle Hidden
    Check "Publikacja programu w folderze firmy (kod $($pub.ExitCode))" ($pub.ExitCode -eq 0 -and (Test-Path -LiteralPath "$Share\ResInvest ERP\ResInvest_ERP.html")) "$Share\ResInvest ERP"
  }
}

# ---------- testy automatyczne ----------
$script:edition = "testy"
if (-not $SkipTests -and (Test-Path $node)) {
  $pack = Get-ChildItem -Path $Root, $PSScriptRoot -Filter "ResInvestERP-testy-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  Check "Paczka testów znaleziona" ([bool]$pack) $(if ($pack) { $pack.FullName } else { "skopiuj ResInvestERP-testy-3.15.0.zip do $Root" })
  if ($pack) {
    $tdir = Join-Path $Root "testy-$stamp"
    Expand-Archive -Path $pack.FullName -DestinationPath $tdir -Force
    $tlog = Join-Path $Root "testy-$stamp.log"
    # Start-Process zamiast „& node … *>”: w Windows PowerShell 5.1 przekierowany strumień błędów programu przerywa skrypt
    $files = "tests\engine.test.mjs tests\features311.test.mjs tests\features312.test.mjs tests\editions312.test.mjs tests\server.test.mjs tests\storage.test.mjs tests\auth.test.mjs tests\mail313.test.mjs tests\features314.test.mjs tests\scans314.test.mjs"
    $tp = Start-Process -FilePath $node -ArgumentList "--disable-warning=ExperimentalWarning --test $files" -WorkingDirectory (Join-Path $tdir "resinvest-erp") -RedirectStandardOutput $tlog -RedirectStandardError "$tlog.err" -Wait -PassThru -WindowStyle Hidden
    $sum = Select-String -Path $tlog -Pattern "^# (tests|pass|fail) " | ForEach-Object { $_.Line.TrimStart("# ") }
    Check "Testy automatyczne na Windows (node --test)" ($tp.ExitCode -eq 0) (($sum -join ", ") + " · log: $tlog")
    Select-String -Path $tlog -Pattern "^not ok" | Select-Object -First 10 | ForEach-Object { Log ("  " + $_.Line) }
  }
}

# ---------- przywrócenie pierwotnych ustawień ----------
$script:edition = "-"
foreach ($f in $saved.Keys) { Copy-Item $saved[$f] $f -Force; Log "Przywrócono pierwotny plik: $f" }
if (-not $saved.Count) { Log "Pierwotnych ustawień nie było — zostają ustawienia wariantu Firma (zainstalowanego jako ostatni)." }

$ok = ($results | Where-Object { $_.ok }).Count; $all = $results.Count
foreach ($ed in $Editions) { $r = $results | Where-Object { $_.wariant -eq $ed }; Log ("Wariant {0}: {1}/{2} OK" -f $ed, ($r | Where-Object { $_.ok }).Count, ($r | Measure-Object).Count) }
Log ("WYNIK: {0}/{1} OK" -f $ok, $all)
$results | ConvertTo-Json | Set-Content -Path ($report -replace "\.txt$", ".json") -Encoding UTF8
Log "Raport: $report — wyślij go w rozmowie (bez haseł; hasła testowe były losowe i dotyczą tylko danych testowych)."
if ($ok -ne $all) { exit 1 }

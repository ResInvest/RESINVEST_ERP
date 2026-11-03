# Buduje ResInvest ERP 3.3 i instalator Windows.  Uruchom z katalogu resinvest-erp:
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 [-NodeVersion 22.22.2] [-SkipTests]
# Wymagania: Node.js >= 22.13 (do budowania), Inno Setup 7 lub 6 (ISCC.exe), dostęp do nodejs.org
# (pobranie node.exe dołączanego do instalatora — suma SHA-256 sprawdzana z SHASUMS256.txt).
param(
  [string]$NodeVersion = "22.22.2",
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "== 1/4 Budowanie ResInvest_ERP.html i danych przykładowych"
node tools/build.mjs
if ($LASTEXITCODE -ne 0) { throw "Budowanie nieudane" }
node tools/export-sample-data.mjs
node tools/i18n-extract.mjs
if ($LASTEXITCODE -ne 0) { throw "Niekompletne tłumaczenia (tools/i18n-extract.mjs)" }

if (-not $SkipTests) {
  Write-Host "== 2/4 Testy jednostkowe i integracyjne"
  node --test tests/engine.test.mjs tests/features34.test.mjs tests/features35.test.mjs tests/features36.test.mjs tests/features38.test.mjs tests/features39.test.mjs tests/pdf.test.mjs tests/platform.test.mjs tests/server.test.mjs tests/auth.test.mjs tests/mail35.test.mjs tests/mail36.test.mjs tests/reg37.test.mjs tests/smtp.test.mjs tests/update.test.mjs tests/storage.test.mjs
  if ($LASTEXITCODE -ne 0) { throw "Testy nie przeszły — instalator nie zostanie zbudowany" }
}

Write-Host "== 3/4 Środowisko Node.js $NodeVersion (win-x64) dla serwera"
$rt = Join-Path $PSScriptRoot "runtime"
New-Item -ItemType Directory -Force -Path $rt | Out-Null
$exe = Join-Path $rt "node.exe"
$stamp = Join-Path $rt "VERSION.txt"
if (-not (Test-Path $exe) -or -not (Test-Path $stamp) -or ((Get-Content $stamp) -ne $NodeVersion)) {
  $base = "https://nodejs.org/dist/v$NodeVersion"
  $zipName = "node-v$NodeVersion-win-x64.zip"
  $zip = Join-Path $env:TEMP $zipName
  Invoke-WebRequest "$base/$zipName" -OutFile $zip
  $sums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content -split "`n"
  $expected = ($sums | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1).Split(" ")[0].Trim()
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "Suma SHA-256 archiwum Node.js nie zgadza się ($actual != $expected)" }
  $tmp = Join-Path $env:TEMP "riw-node-$NodeVersion"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp
  $dir = Join-Path $tmp "node-v$NodeVersion-win-x64"
  Copy-Item (Join-Path $dir "node.exe") $exe -Force
  Copy-Item (Join-Path $dir "LICENSE") (Join-Path $rt "LICENSE-node.txt") -Force
  Set-Content $stamp $NodeVersion
}
& $exe -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<13)) process.exit(1); require('node:sqlite');"
if ($LASTEXITCODE -ne 0) { throw "Dołączony node.exe nie obsługuje node:sqlite (wymagany Node >= 22.13)" }

Write-Host "== 4/4 Kompilacja instalatora (Inno Setup 7 / 6)"
# Kolejność: ISCC z PATH, Inno Setup 7 (64- i 32-bitowy), Inno Setup 6, wpis instalatora w rejestrze
$cands = @()
$onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($onPath) { $cands += $onPath.Source }
$cands += @(
  "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)
foreach ($k in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 7_is1", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 7_is1", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1")) {
  $loc = (Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation
  if ($loc) { $cands += (Join-Path $loc "ISCC.exe") }
}
$iscc = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw "Nie znaleziono ISCC.exe (Inno Setup 7 lub 6). Pobierz: https://jrsoftware.org/isdl.php" }
Write-Host "Kompilator: $iscc"
& $iscc "installer\ResInvestERP.iss"
if ($LASTEXITCODE -ne 0) { throw "Kompilacja instalatora nieudana" }
Write-Host "Gotowe: installer\Output\ResInvestERP_Setup_3.11.0.exe"

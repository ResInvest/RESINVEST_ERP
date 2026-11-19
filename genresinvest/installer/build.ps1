# Budowa instalatora GenResInvest 1.0 na Windows 10/11 (PowerShell).
# Wymagania: Python 3.11-3.13 (64-bit) w PATH, Inno Setup 6 (ISCC.exe).
# Użycie:  powershell -ExecutionPolicy Bypass -File installer\build.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== 1/5 Środowisko wirtualne" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

Write-Host "== 2/5 Testy" -ForegroundColor Cyan
& .\.venv\Scripts\python.exe -m pytest
if ($LASTEXITCODE -ne 0) { throw "Testy nie przeszły - przerywam budowę." }

Write-Host "== 3/5 PyInstaller" -ForegroundColor Cyan
Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue
& .\.venv\Scripts\pyinstaller.exe --noconfirm installer\GenResInvest.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller zakończył się błędem." }

Write-Host "== 4/5 Test uruchomienia .exe" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP "gri-smoke"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$p = Start-Process -FilePath "dist\GenResInvest\GenResInvest.exe" -ArgumentList "--no-browser","--port","8790","--data-dir",$tmp -PassThru -WindowStyle Hidden
try {
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { $r = Invoke-RestMethod "http://127.0.0.1:8790/api/health"; if ($r.status -eq "ok") { $ok = $true; break } } catch {}
  }
  if (-not $ok) { throw "Program .exe nie odpowiada na /api/health" }
  Write-Host "   .exe działa poprawnie" -ForegroundColor Green
} finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

Write-Host "== 5/5 Inno Setup" -ForegroundColor Cyan
$iscc = @("$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Nie znaleziono Inno Setup 6 (ISCC.exe). Zainstaluj z https://jrsoftware.org/isdl.php" }
& $iscc installer\GenResInvest.iss
Write-Host "Gotowe: installer\Output\GenResInvest-1.0.0-setup.exe" -ForegroundColor Green

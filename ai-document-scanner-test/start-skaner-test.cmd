@echo off
rem =====================================================================
rem  ResInvest ERP - AI Document Scanner Test (TRYB TESTOWY)
rem  Uruchamia serwer testowy na http://127.0.0.1:8095 i otwiera przegladarke.
rem  Wymaga Node.js 22.13+ (np. runtime z instalacji ResInvest ERP).
rem  Nie laczy sie z baza ResInvest ERP i niczego nie ksieguje.
rem =====================================================================
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\ResInvestERP\runtime\node.exe" (
    set "PATH=C:\Program Files\ResInvestERP\runtime;%PATH%"
  ) else (
    echo Nie znaleziono Node.js 22.13+. Zainstaluj Node.js albo ResInvest ERP.
    pause
    exit /b 1
  )
)
if not exist "node_modules\@anthropic-ai\sdk" (
  echo Instalacja zaleznosci modulu ^(npm install --omit=dev^)...
  call npm install --omit=dev --no-audit --no-fund
)
start "" "http://127.0.0.1:8095"
node server\scanner-server.mjs %*
pause

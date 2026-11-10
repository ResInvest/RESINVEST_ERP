@echo off
rem ResInvest ERP - otwarcie programu w oknie aplikacji (Edge / Chrome).
rem Osobny profil przegladarki i polityka autoodtwarzania: intro startuje od razu z dzwiekiem.
rem Uzycie: ResInvestERP-Otworz.cmd [adres]   (domyslnie http://localhost:8080/)
setlocal
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=http://localhost:8080/"
set "PROFILE=%LOCALAPPDATA%\ResInvestERP\przegladarka"
if not exist "%PROFILE%" mkdir "%PROFILE%" >/dev/null 2>&1
set "BROWSER="
for %%B in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe") do (
  if not defined BROWSER if exist "%%~B" set "BROWSER=%%~B"
)
if not defined BROWSER (
  rem brak Edge / Chrome - domyslna przegladarka (dzwiek intro po pierwszym kliknieciu)
  start "" "%TARGET%"
  exit /b 0
)
start "" "%BROWSER%" --app="%TARGET%" --user-data-dir="%PROFILE%" --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check
exit /b 0

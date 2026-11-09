@echo off
rem =====================================================================
rem  ResInvest ERP 3.12 - wersja demonstracyjna EUDR (jeden plik HTML)
rem  Otwiera program w domyslnej przegladarce. Nie wymaga instalacji.
rem  Dane demo sa w pamieci przegladarki pod osobnym kluczem -
rem  nie mieszaja sie z danymi ResInvest ERP 3.11.
rem =====================================================================
cd /d "%~dp0"
if not exist "dist\ResInvest_ERP_3.12.0_EUDR_DEMO.html" (
  echo Brak pliku dist\ResInvest_ERP_3.12.0_EUDR_DEMO.html - zbuduj: node tools\build.mjs
  pause
  exit /b 1
)
start "" "dist\ResInvest_ERP_3.12.0_EUDR_DEMO.html"

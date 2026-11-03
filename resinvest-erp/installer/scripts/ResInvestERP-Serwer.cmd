@echo off
rem ResInvest ERP Serwer - uruchomienie (dane: ProgramData\ResInvestERP, konfiguracja: config\server.config.json)
title ResInvest ERP Serwer
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
set "OPEN=--open"
if /i "%~1"=="--no-open" set "OPEN="
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\riw-server.mjs" %OPEN%
if errorlevel 1 (
  echo.
  echo Serwer zakonczyl prace z bledem. Szczegoly: %RIW_DATA%\logs
  pause
)

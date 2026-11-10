@echo off
rem ResInvest ERP Serwer - uruchomienie (dane: ProgramData\ResInvestERP, konfiguracja: config\server.config.json)
rem 3.14: po bledzie krytycznym (kod 70) serwer uruchamia sie ponownie po 5 s; inne bledy - komunikat i pauza
title ResInvest ERP Serwer
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
set "OPEN=--open"
if /i "%~1"=="--no-open" set "OPEN="
:start
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\riw-server.mjs" %OPEN%
if errorlevel 70 if not errorlevel 71 (
  echo Serwer zatrzymal sie po bledzie krytycznym - ponowne uruchomienie za 5 s. Szczegoly: %RIW_DATA%\logs
  timeout /t 5 /nobreak >nul
  set "OPEN="
  goto start
)
if errorlevel 1 (
  echo.
  echo Serwer zakonczyl prace z bledem. Szczegoly: %RIW_DATA%\logs
  pause
)

@echo off
rem ResInvest ERP - migracja bazy SQLite -^> PostgreSQL (serwer ZATRZYMANY). Szczegoly: docs\POSTGRESQL.md
rem Uzycie: ResInvestERP-Migracja.cmd plan ^| migrate --confirm ^| verify ^| rollback
title ResInvest ERP - migracja bazy
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
if "%~1"=="" (
  echo Uzycie: %~nx0 plan ^| migrate --confirm ^| verify ^| rollback
  echo   plan     - tylko odczyt: stan bazy SQLite i PostgreSQL, kroki migracji
  echo   migrate  - kopiuje dane do PostgreSQL ^(wymaga --confirm; plik SQLite pozostaje bez zmian^)
  echo   verify   - porownuje SQLite z PostgreSQL tabela po tabeli
  echo   rollback - zapisuje baze PostgreSQL do pliku .sqlite ^(powrot do SQLite^)
  pause
  exit /b 2
)
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0tools\db-migrate.mjs" %*
echo.
echo Kod wyjscia: %errorlevel%
pause

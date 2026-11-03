@echo off
rem Kopia zapasowa bazy SQLite teraz (dziala takze przy uruchomionym serwerze).
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\riw-server.mjs" --backup-now
echo.
echo Kopie: %RIW_DATA%\backups
pause

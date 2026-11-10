@echo off
rem Kontrola spojnosci bazy i dziennika zmian (lancuch skrotow SHA-256).
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\riw-server.mjs" --check
pause

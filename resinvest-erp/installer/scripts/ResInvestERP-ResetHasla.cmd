@echo off
rem Reset hasla uzytkownika (serwer zatrzymany). Uzycie: ResInvestERP-ResetHasla.cmd login
if "%~1"=="" ( echo Uzycie: %~nx0 ^<login^> & exit /b 1 )
cd /d "%~dp0"
set "RIW_DATA=%ProgramData%\ResInvestERP"
"%~dp0runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\riw-server.mjs" --reset-password %1
pause

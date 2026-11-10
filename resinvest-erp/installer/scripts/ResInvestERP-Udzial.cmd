@echo off
rem =====================================================================
rem  ResInvest ERP - publikacja programu w folderze firmy (udzial sieciowy)
rem  Uzycie: ResInvestERP-Udzial.cmd "\\ue.cz\EPRPL\Data\BIOMASA"
rem  Kopiuje do <folder>\ResInvest ERP: program (tryb lokalny), instrukcje,
rem  skrot do serwera; tworzy <folder>\kopie na kopie bazy.
rem  Baza SQLite zostaje na dysku lokalnym serwera (nie na udziale).
rem  Wymaga polaczenia z siecia firmy (FortiClient VPN).
rem =====================================================================
setlocal
set "SRC=%~dp0"
set "DST=%~1"
if "%DST%"=="" set /p "DST=Folder firmy (np. \\ue.cz\EPRPL\Data\BIOMASA): "
if "%DST%"=="" exit /b 1
if not exist "%DST%\" (
  echo Folder "%DST%" jest niedostepny.
  echo Polacz FortiClient VPN ^(United Energy - VPN^) i uruchom ponownie:
  echo   Menu Start ^> ResInvest ERP ^> Opublikuj program w folderze firmy
  pause
  exit /b 2
)
set "APP=%DST%\ResInvest ERP"
if not exist "%APP%\docs" mkdir "%APP%\docs"
if not exist "%DST%\kopie" mkdir "%DST%\kopie"
robocopy "%SRC%." "%APP%" ResInvest_ERP.html README.md LICENSE ric.ico /R:1 /W:2 /NP /NJH /NJS >nul
if errorlevel 8 goto blad
robocopy "%SRC%docs" "%APP%\docs" *.md *.txt /R:1 /W:2 /NP /NJH /NJS >nul
if errorlevel 8 goto blad
rem adres serwera dla pracownikow: APP_URL z server.env, w przeciwnym razie nazwa tego komputera
set "URL="
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"APP_URL=" "%ProgramData%\ResInvestERP\server.env" 2^>nul`) do set "URL=%%b"
if "%URL%"=="" set "URL=http://%COMPUTERNAME%:8080/"
> "%APP%\ResInvest ERP (serwer).url" (
  echo [InternetShortcut]
  echo URL=%URL%
)
echo Gotowe:
echo   program:  %APP%
echo   serwer:   %URL%
echo   kopie:    %DST%\kopie
if /i not "%~2"=="/quiet" pause
exit /b 0
:blad
echo Kopiowanie do "%APP%" nieudane - sprawdz uprawnienia do folderu i polaczenie VPN.
pause
exit /b 3

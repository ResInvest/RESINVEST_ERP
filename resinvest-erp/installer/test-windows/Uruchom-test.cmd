@echo off
rem ResInvest ERP 3.12 - test odbiorczy: uruchom dwuklikiem z folderu C:\ResInvest-test (prosi o uprawnienia administratora)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList -NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0Test-ResInvestERP.ps1\" -Root \"%~dp0.\""

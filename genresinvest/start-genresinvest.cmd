@echo off
rem Start GenResInvest w trybie deweloperskim (wymaga Python 3.11+ i: pip install -r requirements.txt)
cd /d "%~dp0"
python run.py %*

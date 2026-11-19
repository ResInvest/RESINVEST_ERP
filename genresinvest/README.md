# GenResInvest 1.0 — generator zleceń ResInvest Commodities

*Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

Wystawia zlecenia (przewozy i inne usługi) na **papierze firmowym ResInvest** w formatach **PDF** i **DOCX** —
z kartoteką kontrahentów, słownikami usług / cen / osób, numeracją, korektami, historią, raportami i kopiami zapasowymi.
Działa na komputerze z Windows, a przez przeglądarkę także na innych komputerach i telefonach w sieci firmy.

```
Wybierz kontrahenta ▸ usługę ▸ cenę z listy (lub dopisz nową)  →  Podgląd  →  Wystaw  →  PDF / DOCX
```

## Funkcje

| Obszar | Co robi |
|---|---|
| **Zlecenie** | Układ jak dotychczasowe zlecenia: Zleceniobiorca / Zleceniodawca, krótki opis usługi, cena netto (wiele pozycji, opcjonalnie ilość i wartość), płatność, dokładny opis, towar, punkty, termin załadunku, osoby prowadzące, podpisy. |
| **Listy rozwijane z dopisywaniem** | Kontrahent, krótki opis usługi, trasa/cena netto, jednostka, osoba prowadząca — wybór z listy z wyszukiwaniem albo „+ Dodaj …”. Nowe wartości trafiają do słowników automatycznie. Nowego kontrahenta dodajesz w oknie bez wychodzenia z formularza. |
| **Walidacja i fokus** | NIP (suma kontrolna), kod pocztowy, telefon, e-mail, kwoty (> 0, 2 miejsca), pola wymagane. Komunikat przy polu, fokus na pierwszym błędzie, `Enter` = następne pole, `Ctrl+S` zapis, `Ctrl+P` podgląd. |
| **Dokumenty** | PDF (nagłówek z logo + stopka rejestrowa, „Strona X / N”) i DOCX na oryginalnym `Papier_firmowy_ResInvest.docx` (edytowalny w Word). Szkic ma znak wodny „PROJEKT”, anulowane — „ANULOWANE”. |
| **Numeracja** | `ZL/001/11/2026` — nadawana przy wystawieniu, bez luk, od 1 co miesiąc lub co rok; wzór konfigurowalny. |
| **Korekty** | Zmiana wystawionego zlecenia wymaga powodu i tworzy nową rewizję („Korekta nr 1”); poprzednie wersje i pliki zostają w archiwum. Anulowanie z powodem. |
| **Historia operacji** | Kto, co, kiedy — z porównaniem „było → jest”; filtry: okres, użytkownik, obiekt, akcja, tekst. |
| **Raporty** | Roczny (miesiące: wystawione, anulowane, wartość netto), za okres: kontrahenci, trasy i stawki (min/średnia/max); eksport rejestru do XLSX/CSV. |
| **Import / eksport** | Kontrahenci CSV (UTF-8 / Windows-1250, z próbnym sprawdzeniem), kartoteki JSON, rejestr XLSX/CSV. |
| **Bezpieczeństwo danych** | SQLite WAL + pełna synchronizacja zapisu, kwoty w groszach, migawki danych w zleceniu, blokada przed nadpisaniem cudzych zmian, archiwum plików z SHA-256, kopie zapasowe automatyczne (co 24 h, rotacja 30) i ręczne, przywracanie z kopią bezpieczeństwa. |
| **Wieloużytkowość** | Konta z rolami: Administrator, Użytkownik, Podgląd; hasła PBKDF2, blokada po 5 nieudanych logowaniach, wymuszona zmiana hasła startowego. |
| **Responsywność** | Komputer, tablet, telefon (tabele jako karty, przyklejony pasek akcji); tryb ciemny. |

## Instalacja (Windows 10/11)

1. Uruchom `GenResInvest-1.0.0-setup.exe` (jak go zbudować — niżej).
2. Opcje instalatora: skrót na pulpicie, uruchamianie przy logowaniu, **dostęp z sieci firmowej** (port 8765 + reguła zapory).
3. Uruchom **GenResInvest** — otworzy się okno serwera i przeglądarka z adresem `http://127.0.0.1:8765`.
   Zamknięcie okna serwera zatrzymuje program.
4. Pierwsze logowanie: login `admin`, hasło startowe z pliku `C:\ProgramData\GenResInvest\HASLO_STARTOWE_ADMINA.txt`.
   Program wymusi ustawienie własnego hasła — potem usuń ten plik.
5. W **Administracja → Użytkownicy** dodaj konta pracowników (każdy dostaje hasło startowe).

Telefon / inny komputer (opcja „dostęp z sieci”): `http://NAZWA-KOMPUTERA:8765` lub `http://ADRES-IP:8765`.

**Dane** (baza, archiwum dokumentów, kopie, logi): `C:\ProgramData\GenResInvest` — nie są usuwane przy odinstalowaniu.
Zalecenie: kopiuj regularnie katalog `backups` na inny dysk / serwer.

## Budowa instalatora

Na Windows z Python 3.11–3.13 (64-bit) i [Inno Setup 6](https://jrsoftware.org/isdl.php):

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

Skrypt: tworzy `.venv`, instaluje zależności, **uruchamia testy**, buduje `.exe` (PyInstaller), sprawdza czy `.exe` odpowiada,
kompiluje instalator → `installer\Output\GenResInvest-1.0.0-setup.exe`.

## Uruchomienie deweloperskie (Windows / Linux / macOS)

```bash
pip install -r requirements-dev.txt
python run.py                   # http://127.0.0.1:8765, dane w ./data
python run.py --host 0.0.0.0    # dostęp z sieci lokalnej
python run.py --demo-orders     # przykładowe zlecenia do testów raportów
python run.py --backup-now      # kopia zapasowa i wyjście
python run.py --reset-admin     # nowe hasło startowe dla konta admin
python -m pytest                # testy
```

Dokumentacja API (Swagger): `http://127.0.0.1:8765/api/docs`.

## Konfiguracja

Plik `.env` obok programu lub w katalogu danych (wzór: [`.env.example`](.env.example)); zmienne `GRI_*` mają pierwszeństwo.
Najważniejsze: `GRI_HOST`, `GRI_PORT`, `GRI_DATA_DIR`, `GRI_BACKUP_INTERVAL_HOURS`, `GRI_BACKUP_KEEP`.
W programie (**Administracja**): dane firmy (Zleceniodawcy), wzór numeru, termin płatności, miejsce wystawienia,
jednostki, tytuł dokumentu, tekst płatności, klauzula końcowa.

## Dane testowe

* `sample_data/dane_startowe.json` — wczytywane przy pierwszym uruchomieniu: 4 kontrahentów, opis usługi, cena
  „Zabrze - Chorzów 900 zł/fracht”, osoba prowadząca — odczytane z dostarczonych wzorów zleceń.
  **Uwaga:** we wzorze zlecenia SmartTrans wpisano NIP 6460007202, który należy do VASCO — w kartotece SmartTrans
  NIP jest pusty, do uzupełnienia.
* `sample_data/kontrahenci_przyklad.csv` — wzór pliku do importu kontrahentów.
* `python run.py --demo-orders` — 24 przykładowe zlecenia (wystawione, szkice, anulowane) do raportów.

## Architektura

Szczegóły: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) — schemat systemu, struktura plików, schemat bazy danych,
punkty końcowe API, architektura interfejsu, plan skalowania.

Stos: Python 3.11+ · FastAPI · SQLAlchemy 2 · SQLite (WAL) · python-docx · reportlab · openpyxl · vanilla JS (moduły ES).

## Licencja

Zob. [LICENSE](LICENSE).
